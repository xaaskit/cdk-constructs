import * as cb from '@aws-cdk/aws-codebuild';
import * as iam from '@aws-cdk/aws-iam';
import * as kms from '@aws-cdk/aws-kms';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as cdk from '@aws-cdk/core';
import { integrationResourceArn, validatePatternSupported } from './task-utils';

/**
 * Properties for starting a CodeBuild project with StartBuild
 */
export interface StartBuildProps extends sfn.TaskStateBaseProps {
  readonly project: cb.IProject;
  readonly role?: iam.IRole;
  readonly cache?: cb.Cache
  readonly buildSpec?: cb.BuildSpec;
  readonly encryptionKey?: kms.IKey;
  readonly buildEnvironment?: cb.BuildEnvironment;
  readonly buildTimeout?: cdk.Duration;
  readonly artifacts?: cb.IArtifacts;
  readonly secondaryArtifacts?: cb.IArtifacts[];
  readonly source?: cb.ISource;
  readonly sourceType?: string;
  readonly sourceLocation?: string;
  readonly secondarySources?: cb.ISource[];
  readonly environmentVariables?: {[name: string]: cb.BuildEnvironmentVariable};
}

/**
 * Start a CodeBuild project as a Task
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/connect-codebuild.html
 */
export class StartBuild extends sfn.TaskStateBase {
  private static readonly SUPPORTED_INTEGRATION_PATTERNS: sfn.IntegrationPattern[] = [
    sfn.IntegrationPattern.REQUEST_RESPONSE,
    sfn.IntegrationPattern.RUN_JOB,
  ];

  protected readonly taskMetrics?: sfn.TaskMetricsConfig;
  protected readonly taskPolicies?: iam.PolicyStatement[];

  private readonly integrationPattern: sfn.IntegrationPattern;

  constructor(scope: cdk.Construct, id: string, private readonly props: StartBuildProps) {
    super(scope, id, props);
    this.integrationPattern = props.integrationPattern ?? sfn.IntegrationPattern.RUN_JOB;

    validatePatternSupported(this.integrationPattern, StartBuild.SUPPORTED_INTEGRATION_PATTERNS);

    this.taskPolicies = [
      new iam.PolicyStatement({
        actions: [
          'codebuild:StartBuild',
          'codebuild:StopBuild',
          'codebuild:BatchGetBuilds',
          'codebuild:BatchGetReports',
        ],
        resources: [this.props.project.projectArn],
      }),
      new iam.PolicyStatement({
        actions: [
          'events:PutTargets',
          'events:PutRule',
          'events:DescribeRule'
        ],
        resources: [
          cdk.Arn.format({ service: 'events', resource: 'rule', resourceName: 'StepFunctionsGetEventForCodeBuildStartBuildRule'}, cdk.Stack.of(this))
        ]
      }),
    ];
  }

  /**
   * Provides the CodeBuild start build service integration task configuration
   */
  protected renderTask(): any {
    const environment = this.props.buildEnvironment;
    const sourceConfig = this.props.source && this.props.source?.bind(this, this.props.project);
    const secondarySourceConfigs = this.props.secondarySources && this.props.secondarySources?.map(s => s.bind(this, this.props.project));

    const projectVars = this.props.environmentVariables ?? {};
    const environmentVars =  this.props.buildEnvironment?.environmentVariables ?? {};
    for (const name of Object.keys(projectVars)) {
      environmentVars[name] = projectVars[name];
    }
    return {
      Resource: integrationResourceArn('codebuild', 'startBuild', this.integrationPattern),
      Parameters: sfn.FieldUtils.renderObject({
        ProjectName: this.props.project.projectName,
        ArtifactsOverride: this.props.artifacts,
        BuildspecOverride: this.props.buildSpec && this.props.buildSpec.toBuildSpec(),
        //CacheOverride: this.props.cache && this.props.cache._toCloudFormation(),
        // CertificateOverride: undefined,
        ComputeTypeOverride: environment?.computeType,
        EncryptionKeyOverride: cdk.Lazy.stringValue({ produce: () => this.props.encryptionKey && this.props.encryptionKey.keyArn }),
        EnvironmentTypeOverride: environment?.buildImage?.type,
        EnvironmentVariablesOverride: this.serializeEnvVariables(environmentVars),
        GitCloneDepthOverride: sourceConfig?.sourceProperty.gitCloneDepth,
        GitSubmodulesConfigOverride: sourceConfig?.sourceProperty.gitSubmodulesConfig,
        // IdempotencyToken: undefined,
        ImageOverride: environment?.buildImage?.imageId,
        ImagePullCredentialsTypeOverride: environment?.buildImage?.imagePullPrincipalType,
        InsecureSslOverride: sourceConfig?.sourceProperty.insecureSsl,
        // LogsConfigOverride: undefined,
        PrivilegedModeOverride: environment?.privileged,
        // QueuedTimeoutInMinutesOverride: undefined,
        // RegistryCredentialOverride: undefined,
        // ReportBuildStatusOverride: undefined,
        SecondaryArtifactsOverride: this.props.secondaryArtifacts,
        SecondarySourcesOverride: secondarySourceConfigs,
        // SecondarySourcesVersionOverride: undefined,
        ServiceRoleOverride: this.props.role && this.props.role.roleName,
        SourceAuthOverride: sourceConfig?.sourceProperty.auth,
        SourceLocationOverride: this.props.sourceLocation ?? sourceConfig?.sourceProperty.location,
        SourceTypeOverride: this.props.sourceType ?? sourceConfig?.sourceProperty.type,
        SourceVersion: sourceConfig?.sourceVersion,
        TimeoutInMinutesOverride: this.props.buildTimeout && this.props.buildTimeout.toMinutes(),
      }),
    };
  }

  private serializeEnvVariables(environmentVariables: {[name: string]: cb.BuildEnvironmentVariable}) {
    if( Object.entries(environmentVariables).length === 0) {
      return undefined;
    }
    return Object.keys(environmentVariables).map(name => ({
      Name: name,
      Type: environmentVariables[name].type || cb.BuildEnvironmentVariableType.PLAINTEXT,
      Value: environmentVariables[name].value,
    }));
  }
}