import * as aws from 'aws-sdk';

let stepfunctionsClient: aws.StepFunctions;

function stepfunctions() {
  if (!stepfunctionsClient) { stepfunctionsClient = new aws.StepFunctions(); }
  return stepfunctionsClient;
}

function defaultLogger(fmt: string, ...args: any[]) {
  // tslint:disable-next-line: no-console
  console.log(fmt, ...args);
}

export const external = {
  log: defaultLogger,
  startExecution: (req: aws.StepFunctions.StartExecutionInput) => stepfunctions().startExecution(req).promise(),
};