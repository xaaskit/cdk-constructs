import * as api from '@aws-cdk/aws-apigatewayv2';
import * as cdk from '@aws-cdk/core';
import * as fn from '@aws-cdk/aws-lambda';

const RESOURCE_TYPE = 'Custom::XaasKitGitHubWebhookProvider';

export interface WebhookProps {
  readonly handler: fn.IFunction;
  readonly api?: api.HttpApi;
  readonly apiPath?: string;
  readonly events: string[];
  readonly active?: boolean;
  readonly accessToken?: cdk.SecretValue;
}

export interface WebhookResourceProviderProperties {
  readonly owner?: string;
  readonly repository?: string;
  readonly organization?: string;
}


export abstract class Webhook extends cdk.Construct {

  public readonly api: api.HttpApi;

  public readonly webhookId: string;
  public readonly webhookUrl: string;

  constructor(scope: cdk.Construct, id: string, props: WebhookProps) {
    super(scope, id);

    const path = props.apiPath ?? '/webhook/handle';

    this.api = props.api ?? new api.HttpApi(this, 'API');
    this.api.addRoutes({
      path,
      methods: [ api.HttpMethod.POST ],
      integration: new api.LambdaProxyIntegration({ handler: props.handler }),
    });

    const resource = new cdk.CustomResource(this, 'Resource', {
      resourceType: RESOURCE_TYPE,
      serviceToken: this.getOrCreateProvider(),
      properties: {
        WebhookUrl: this.api.url + (path.startsWith('/') ? path.substring(1) : path),
        WebhookEvents: props.events,
        WebhookActive: props.active ?? true,
        GitHubAccessToken: props.accessToken?.toString(),
        ...this.ProcessObjectCasing(this.resolveProviderProperties()),
      },
    });

    this.webhookId = resource.ref;
    this.webhookUrl = resource.getAttString('Url');
  }

  protected abstract resolveProviderProperties(): WebhookResourceProviderProperties;

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

  private ProcessObjectCasing(obj: any): any {
    const result: {[k: string]: any} = {};
    Object.keys(obj).forEach(key => result[key.substring(0, 1).toUpperCase() + key.substring(1)] = obj[key]);
    return result;
  }
}