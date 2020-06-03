import * as cdk from '@aws-cdk/core';
import * as cb from '@aws-cdk/aws-codebuild';
import * as dns from '@aws-cdk/aws-route53';
import * as ecr from '@aws-cdk/aws-ecr';
import * as fn from '@aws-cdk/aws-lambda';
import * as gh from '@xaaskit-cdk/github';
import * as iam from '@aws-cdk/aws-iam';
import * as path from 'path';
import * as s3 from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as sns from '@aws-cdk/aws-sns';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { StartBuild } from './tasks/start-build';

export interface GitHubFlowProps {
  readonly owner: string;
  readonly repository: string;
  readonly hostedZone: dns.IHostedZone;
  readonly applicationName?: string;
  readonly productionClusterName: string;
  readonly productionClusterNamespace?: string;
  readonly developmentHostnamePrefix?: string;
  readonly developmentClusterName?: string;
  readonly developmentClusterNamespace?: string;
  readonly cdkChartName?: string;
  readonly cdkStackName?: string;
  readonly cdkDirectory?: string;
  readonly githubToken: cdk.SecretValue;
}

export class GitHubFlow extends cdk.Construct {

  public readonly topic: sns.ITopic;

  constructor(scope: cdk.Construct, id: string, props: GitHubFlowProps) {
    super(scope, id);

    const applicationName = props.applicationName ?? props.repository;
    const hostname = `${applicationName}.${props.hostedZone.zoneName}`;
    const cdkDirectory = props.cdkDirectory ?? './cdk';
    const cdkStackName = props.cdkStackName ?? 'Application';
    const cdkChartName = props.cdkChartName ?? 'Application';    

    // Resources
    this.topic = new sns.Topic(this, 'Topic', {});
    const repository = new ecr.Repository(this, 'Repository');
    const artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket');

    // CodeBuild Projects
    const source = cb.Source.gitHub({
      owner: props.owner,
      repo: props.repository,
      branchOrRef: 'master'
    });
    const applicationBuildRole = new iam.Role(this, 'ApplicationBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });
    repository.grantPullPush(applicationBuildRole);
    const applicationBuild = new cb.Project(this, 'ApplicationBuildProject', {
      source,
      role: applicationBuildRole,
      environment: {
        privileged: true,
      },
      environmentVariables: {
        AWS_ACCOUNT_ID: { value: cdk.Stack.of(this).account },
        IMAGE_TAG: { value: 'latest' },
        IMAGE_REPO_NAME: { value: repository.repositoryName },
      }
    });

    const infrastructureBuild = new cb.Project(this, 'InfrastructureBuildProject', {
      source,
      buildSpec: cb.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              `cd ${cdkDirectory}`,
              `npm install`
            ]
          },
          build: { 
            commands: [
              `cd ${cdkDirectory}`,
              'npm run build',
              `npm run synth ${cdkStackName} -- -o dist`,
              'npm run synth-k8s -- --host $APP_HOSTNAME --image $APP_IMAGE --image-tag $APP_IMAGE_TAG',
            ],
          },
        },
        artifacts: {
          files: [
            `${cdkStackName}.template.json`,
            `${cdkChartName}.k8s.yaml`,
          ],
          'base-directory': `${cdkDirectory}/dist`
        },
      }),
      environmentVariables: {
        APP_IMAGE: { value: repository.repositoryUri },
        APP_IMAGE_TAG: { value: 'latest' },
        APP_HOSTNAME: { value: hostname },
      },
      artifacts: cb.Artifacts.s3({  
        bucket: artifactsBucket,
        includeBuildId: true,
        packageZip: true,
        path: 'githubflow',
        identifier: 'githubflow-infrastructure',
      })
    });

    const deploymentBuildRole = new iam.Role(this, 'DeploymentBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });
    deploymentBuildRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        'eks:DescribeNodegroup',
        'eks:DescribeUpdate',
        'eks:DescribeCluster',
      ]
    }));
    artifactsBucket.grantRead(deploymentBuildRole);
    const deploymentClusterRole = new iam.Role(this, 'DeploymentClusterRole', {
      assumedBy: new iam.ArnPrincipal(deploymentBuildRole.roleArn),
    });
    deploymentClusterRole.grant(deploymentBuildRole, 'sts:AssumeRole');
    const deploymentBuild = new cb.Project(this, 'DeploymentBuildProject', {
      role: deploymentBuildRole,
      buildSpec: cb.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'curl -LO https://storage.googleapis.com/kubernetes-release/release/v1.16.0/bin/linux/amd64/kubectl',
              'chmod +x ./kubectl',
              'export PATH=$PWD/:$PATH',
              'aws eks update-kubeconfig --name $CLUSTER_NAME --role-arn $CLUSTER_ROLE_ARN'
            ]
          },
          build: {
            commands: [
              `kubectl apply --namespace $CLUSTER_NAMESPACE -f ${cdkChartName}.k8s.yaml`,
            ],
          },
        },
      }),
      environmentVariables: {
        CLUSTER_NAME: { value: props.productionClusterName },
        CLUSTER_NAMESPACE: { value: props.productionClusterNamespace ?? 'default' },
        CLUSTER_ROLE_ARN: { value: deploymentClusterRole.roleArn },
      }
    });

    // Pipeline
    /// Steps
    const fail = new sfn.Fail(this, 'Fail');
    const success = new sfn.Succeed(this, 'Succeeded');
    const notifyPrending = this.taskNotifyStatus(this.topic, 'Pending');
    const notifySucceeded = this.taskNotifyStatus(this.topic, 'Succeeded').next(success);
    const definition = sfn.Chain
      .start(notifyPrending)
      .next(new sfn.Parallel(this, 'Build', { resultPath: '$.Build' })
        .branch(
          new StartBuild(this, 'BuildApplication', {
            project: applicationBuild,
            source: cb.Source.gitHub({
              owner: props.owner,
              repo: props.repository,
              branchOrRef: sfn.Data.stringAt('$.Webhook.Commit.Id')
            }),
            environmentVariables: {
              IMAGE_TAG: { value: sfn.Data.stringAt('$.Webhook.Commit.Version') },
            },
            outputPath: '$.Build'
          })
        )
        .branch(
          new StartBuild(this, 'BuildInfrastructure', {
            project: infrastructureBuild,
            source: cb.Source.gitHub({
              owner: props.owner,
              repo: props.repository,
              branchOrRef: sfn.Data.stringAt('$.Webhook.Commit.Id')
            }),
            environmentVariables: {
              APP_IMAGE_TAG: { value: sfn.Data.stringAt('$.Webhook.Commit.Version') },
              APP_HOSTNAME: { value: sfn.Data.stringAt('$.Webhook.Application.HostName') },
            },
            outputPath: '$.Build'
          })
        ).addCatch(this.taskNotifyStatus(this.topic, 'BuildFailed').next(fail))
      )
      .next(
        new StartBuild(this, 'DeployInfrastructure', {
          project: deploymentBuild,
          sourceType: 'S3',
          sourceLocation: sfn.Data.stringAt("$.Build[1].Artifacts.Location"),
          environmentVariables: {
            CLUSTER_NAME: { value: sfn.Data.stringAt('$.Webhook.Application.Cluster') },
            CLUSTER_NAMESPACE: { value: sfn.Data.stringAt('$.Webhook.Application.Namespace') },
          },
          outputPath: '$.Deployment'
        }).addCatch(this.taskNotifyStatus(this.topic, 'DeploymentFailed').next(fail))
      )
      .next(notifySucceeded);
    
    const stateMachine = new sfn.StateMachine(this, 'StateMachine', { definition });
    // Webhook
    const handler = new fn.Function(this, 'WebhookHandler', {
      runtime: fn.Runtime.NODEJS_12_X,
      code: fn.Code.fromAsset(path.join(__dirname, 'webhook-handler')),
      handler: 'index.handler',
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        PRODUCTION_HOSTNAME: props.hostedZone.zoneName,
        PRODUCTION_CLUSTER_NAME: props.productionClusterName,
        PRODUCTION_CLUSTER_NAMESPACE: props.productionClusterNamespace ?? 'default',
        DEVELOPMENT_HOSTNAME: props.developmentHostnamePrefix ? `${props.developmentHostnamePrefix}.${props.hostedZone.zoneName}` : props.hostedZone.zoneName,
        DEVELOPMENT_CLUSTER_NAME: props.developmentClusterName ?? props.productionClusterName,
        DEVELOPMENT_CLUSTER_NAMESPACE: props.developmentClusterNamespace ?? props.productionClusterNamespace ?? 'default',
      }
    });
    new gh.RepositoryWebhook(this, 'Webhook', {
      handler,
      owner: props.owner,
      repository: props.repository,
      events: [ 'pull_request', 'push' ],
      accessToken: cdk.SecretValue.secretsManager('github-token'),
    });
  }

  private readonly notifyTasks: {[key: string]: tasks.SnsPublish} = {};
  private taskNotifyStatus(topic: sns.ITopic, status: string) {
    if (!this.notifyTasks[status]) {
      this.notifyTasks[status] = new tasks.SnsPublish(this, 'Notify' + status, {
        topic,
        resultPath: sfn.DISCARD,
        message: sfn.TaskInput.fromObject({
          Status: status,
          Webhook: '$.Webhook',
        })
      });  
    }
    return this.notifyTasks[status];
  }
}