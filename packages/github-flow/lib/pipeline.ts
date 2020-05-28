import * as acm from '@aws-cdk/aws-certificatemanager';
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
import { SecretValue } from '@aws-cdk/core';

export interface GitHubFlowProps {
  readonly owner: string;
  readonly repository: string;
  readonly hostedZone: dns.IHostedZone;
  readonly name?: string,
  readonly clusterName: string,
  readonly githubToken: SecretValue,
}

export class GitHubFlow extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: GitHubFlowProps) {
    super(scope, id);

    const name = props.name ?? props.repository;
    const hostname = `${name}.${props.hostedZone.zoneName}`;

    // Webhook
    const handler = new fn.Function(this, 'WebhookHandler', {
      runtime: fn.Runtime.NODEJS_12_X,
      code: fn.Code.fromAsset(path.join(__dirname, 'webhook-handler')),
      handler: 'index.handler'
    });
    new gh.RepositoryWebhook(this, 'Webhook', {
      handler,
      owner: props.owner,
      repository: props.repository,
      events: [ 'pull_request', 'push' ],
      accessToken: cdk.SecretValue.secretsManager('github-token'),
    })

    // Resources
    new acm.DnsValidatedCertificate(this, 'PullRequestCertificate', {
      domainName: `*.${hostname}`,
      hostedZone: props.hostedZone
    });

    const topic = new sns.Topic(this, 'Topic', {});
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
            commands: [ 'npm install --prefix ./cdk' ]
          },
          build: {
            commands: [
              'npm run --prefix ./cdk build',
              'npm run --prefix ./cdk synth -- -o dist',
              'npm run --prefix ./cdk synth-k8s -- --host $APP_HOSTNAME --image $APP_IMAGE --image-tag $APP_IMAGE_TAG',
            ],
          },
        },
        artifacts: {
          files: [
            'Application.template.json',
            'Application.k8s.yaml',
          ],
          'base-directory': 'cdk/dist'
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
              'kubectl apply --namespace $CLUSTER_NAMESPACE -f Application.k8s.yaml',
            ],
          },
        },
      }),
      environmentVariables: {
        CLUSTER_NAME: { value: props.clusterName },
        CLUSTER_NAMESPACE: { value: 'default' },
        CLUSTER_ROLE_ARN: { value: deploymentClusterRole.roleArn },
      }
    });

    // Pipeline
    /// Steps
    const fail = new sfn.Fail(this, 'Fail');
    const success = new sfn.Succeed(this, 'Succeeded');
    const notifyPrending = this.taskNotifyStatus(topic, 'Pending');
    const notifySucceeded = this.taskNotifyStatus(topic, 'Succeeded').next(success);
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
        ).addCatch(this.taskNotifyStatus(topic, 'BuildFailed').next(fail))
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
        }).addCatch(this.taskNotifyStatus(topic, 'DeploymentFailed').next(fail))
      )
      .next(notifySucceeded);
    
    new sfn.StateMachine(this, 'StateMachine', { definition });
  }

  private readonly notifyTasks: {[key: string]: tasks.SnsPublish} = {};
  private taskNotifyStatus(topic: sns.Topic, status: string) {
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