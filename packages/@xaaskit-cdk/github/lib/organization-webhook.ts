import * as cdk from '@aws-cdk/core';
import { Webhook, WebhookProps, WebhookResourceProviderProperties } from './webhook';

export interface OrganizationWebhookProps extends WebhookProps {
  readonly organization: string;
}

export class OrganizationWebhook extends Webhook {
  constructor(scope: cdk.Construct, id: string, readonly props: OrganizationWebhookProps) {
    super(scope, id, props);
  }

  protected resolveProviderProperties() : WebhookResourceProviderProperties {
    return {
      organization: this.props.organization,
    }
  }
}