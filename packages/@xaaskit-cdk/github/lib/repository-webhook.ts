import * as cdk from '@aws-cdk/core';
import { WebhookProps, Webhook, WebhookResourceProviderProperties } from './webhook';

export interface RepositoryWebhookProps extends WebhookProps {
  readonly owner: string;
  readonly repository: string;
}


export class RepositoryWebhook extends Webhook {
  constructor(scope: cdk.Construct, id: string, readonly props: RepositoryWebhookProps) {
    super(scope, id, props);
  }

  protected resolveProviderProperties(): WebhookResourceProviderProperties {
    return {
      owner: this.props.owner,
      repository: this.props.repository,
    }
  }
}