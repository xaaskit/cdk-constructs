import * as api from '@aws-cdk/aws-apigatewayv2';
import * as cdk from '@aws-cdk/core';
import * as fn from '@aws-cdk/aws-lambda';

const RESOURCE_TYPE = 'Custom::XaasKitGitHubWebhookProvider';

export interface RepositoryWebhookProps {
  readonly handler: fn.IFunction;
  readonly api?: api.HttpApi;
  readonly apiPath?: string;
  readonly owner: string;
  readonly repository: string;
  readonly events: string[];
  readonly active?: boolean;
  readonly token?: string;
  readonly tokenSecretId: string;
}

export class RepositoryWebhook extends cdk.Construct {

  public readonly api: api.HttpApi;

  constructor(scope: cdk.Construct, id: string, props: RepositoryWebhookProps) {
    super(scope, id);

    const path = props.apiPath ?? '/webhook/handle';

    this.api = props.api ?? new api.HttpApi(this, 'API');
    this.api.addRoutes({
      path,
      methods: [ api.HttpMethod.POST ],
      integration: new api.LambdaProxyIntegration({ handler: props.handler }),
    });

    new cdk.CustomResource(this, 'Resource', {
      resourceType: RESOURCE_TYPE,
      serviceToken: this.getOrCreateProvider(),
      properties: {
        WebbookUrl: this.api.url + (path.startsWith('/') ? path.substring(1) : path),
        WebbookActive: props.active ?? true,
        Repository: props.repository,
        RepositoryOwner: props.owner,
        RepositoryEvents: props.events,
        GitHubToken: props.token,
        GitHubTokenSecretId: props.tokenSecretId ?? 'github-token',
      },
    });
  }

  private getOrCreateProvider() {
    return cdk.CustomResourceProvider.getOrCreate(this, RESOURCE_TYPE, {
      codeDirectory: `${__dirname}/webhook-provider`,
      runtime: cdk.CustomResourceProviderRuntime.NODEJS_12,
      policyStatements: [
        {
          Effect: 'Allow',
          Resource: '*',
          Action: [ 'secretsmanager:GetSecretValue' ],
        }
      ]
    });
  }
}