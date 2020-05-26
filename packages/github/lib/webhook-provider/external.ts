/* istanbul ignore file */

// eslint-disable-next-line import/no-extraneous-dependencies
import * as aws from 'aws-sdk';
import * as https from 'https';

let client: aws.SecretsManager;

function secretsManager() {
  if (!client) { client = new aws.SecretsManager(); }
  return client;
}

function createWebhook(owner: string, repository: string, token: string, url: string, events: string[]) {
  const options = {
    host: 'api.github.com',
    port: 443,
    path: `/repos/${owner}/${repository}/hooks`,
    // authentication headers
    headers: {
       'Authorization': 'token ' + token
    }
  };
  const data = {
    name: 'web',
    config: {
      url,
      content_type: 'json'
    },
    events,
  };
  return new Promise(function(resolve, reject) {
    var req = https.request(options, function(res) {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        return reject(new Error('statusCode=' + res.statusCode));
      }
      let body: any[] = [];
      res.on('data', function(chunk) {
          body.push(chunk);
      });
      res.on('end', function() {
        try {
            body = JSON.parse(Buffer.concat(body).toString());
        } catch(e) {
            reject(e);
        }
        resolve(body);
      });
    });
    req.on('error', function(err) {
      reject(err);
    });
    req.write(data);
    req.end();
  });
}

function defaultLogger(fmt: string, ...args: any[]) {
  // tslint:disable-next-line: no-console
  console.log(fmt, ...args);
}

export const external = {
  log: defaultLogger,
  createWebhook,
  getSecretValue: (req: aws.SecretsManager.GetSecretValueRequest) => secretsManager().getSecretValue(req).promise(),
};