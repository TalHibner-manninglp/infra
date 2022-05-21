import { Construct } from "constructs";
import { Fn, TerraformStack, TerraformOutput } from "cdktf";
import { AwsProvider, ecr, elb, ecs, iam, codebuild, datasources } from "@cdktf/provider-aws";
import { SecurityGroup } from '../../.gen/modules/security-group';

interface PetAppStackConfig {
  profile: string;
  vpcId: string;
  publicSecurityGroup: SecurityGroup;
  appSecurityGroup: SecurityGroup;
  publicSubnets: string[] | undefined;
  appSubnets: string[] | undefined;
  ecsClusterName: string;
  repository: string;
  branch: string;
}

export default class PetAppStack extends TerraformStack {
  constructor(scope: Construct, name: string, config: PetAppStackConfig) {
    super(scope, name);

    new AwsProvider(this, "agency.dev", {
      region: "us-east-1",
      profile: config.profile,
    });

    const ecrRepository = new ecr.EcrRepository(this, "repository", {
      name: "repository",
      imageTagMutability: "MUTABLE"
    })

    new ecr.EcrRepositoryPolicy(this, 'ecrPolicy', {
      repository: ecrRepository.name,
      policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                "Sid": "CodeBuildAccessPrincipal",
                "Effect": "Allow",
                "Principal": {
                  "Service":"codebuild.amazonaws.com"
                },
                "Action": [
                  "ecr:GetDownloadUrlForLayer",
                  "ecr:BatchGetImage",
                  "ecr:BatchCheckLayerAvailability",
                ]
              }
            ]
      })
    })

    const containerPort = 3456;

    const targetGroup = new elb.LbTargetGroup(this, "targetGroup", {
      name: "myTargetGroup",
      port: containerPort,
      protocol: 'HTTP',
      targetType: 'ip',
      vpcId: config.vpcId,
    })

    const loadBalancer = new elb.Alb(this, 'loadBalancer', {
      name: "myAlb",
      internal: false,
      loadBalancerType: "application",
      subnets: config.publicSubnets || [],
      securityGroups: [config.publicSecurityGroup.securityGroupIdOutput],
    })

    new elb.LbListener(this, 'listener', {
      loadBalancerArn: loadBalancer.arn,
      port: 80,
      protocol: "HTTP",
      defaultAction: [
        {
          type: "forward",
          targetGroupArn: targetGroup.arn,
        },
      ],
    })

    const ecsTaskExecutionRoleAssumeRolePolicyDocument = new iam.DataAwsIamPolicyDocument(this, "ecsTaskExecutionRoleAssumeRolePolicyDocument", {
      statement: [
          {
            effect: "Allow",
            principals: [{
              type: "Service",
              identifiers: ["ecs-tasks.amazonaws.com"],
            }],
            actions: ["sts:AssumeRole"]
          }
        ]
    })

    const ecsTaskExecutionRole = new iam.IamRole(this, "ecsTaskExecutionRole", {
      name: `${name}-execution`,
      assumeRolePolicy: ecsTaskExecutionRoleAssumeRolePolicyDocument.json,
    })

    new iam.IamRolePolicyAttachment(this, "ecsTaskExecutionRoleRolePolicyAttachment", {
      role: ecsTaskExecutionRole.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
    })

    const ecsTaskDefinition = new ecs.EcsTaskDefinition(this, "taskDefinition", {
      family: name,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: '256',
      memory: '512',
      executionRoleArn: ecsTaskExecutionRole.arn,
      containerDefinitions: Fn.jsonencode([
        {
          name: "petapp",
          image: "petapp",
          cpu: 10,
          memory: 512,
          essential: true,
          environment: [
            { "name" : "PORT", "value" : "3456" },
          ],
          portMappings: [
            {
              containerPort: 3456,
              hostPort: 3456,
            },
          ],
        }
      ])
    })
    
    // @ts-ignore
    const ecsService = new ecs.EcsService(this, "service", {
      name: "ecsService",
      launchType: "FARGATE",
      cluster: config.ecsClusterName,
      desiredCount: 1,
      taskDefinition: ecsTaskDefinition.arn,
      forceNewDeployment: true,
      networkConfiguration: {
        subnets: config.publicSubnets || [],
        assignPublicIp: true,
        securityGroups: [config.appSecurityGroup.securityGroupIdOutput],
      },
      loadBalancer: [
        {
          containerPort: 3456,
          containerName: name,
          targetGroupArn: targetGroup.arn,
        },
      ],
    });

    // @ts-ignore
    const callerIdentity = new datasources.DataAwsCallerIdentity(this, "current")

    const codebuildServiceRoleAssumeRolePolicyDocument = new iam.DataAwsIamPolicyDocument(this, "codebuildServiceRoleAssumeRolePolicyDocument", {
      statement: [
          {
            effect: "Allow",
            principals: [{
              type: "Service",
              identifiers: ["codebuild.amazonaws.com"],
            }],
            actions: ["sts:AssumeRole"]
          }
        ]
    })

    const codebuildServiceRole = new iam.IamRole(this, "codebuildServiceRole", {
      name: `${name}-codebuild-service-role`,
      assumeRolePolicy: codebuildServiceRoleAssumeRolePolicyDocument.json,
    })

    const codebuildServiceRolePolicy = new iam.IamPolicy(this, "codebuildServiceRolePolicy", {
      policy: Fn.jsonencode({
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Action": [
              "cloudwatch:*",
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "s3:PutObject",
              "s3:GetObject",
              "s3:GetObjectVersion",
              "s3:GetBucketAcl",
              "s3:GetBucketLocation",

              // Allow CodeBuild access to AWS services required to create a VPC network interface
              "ec2:CreateNetworkInterface",
              "ec2:DescribeDhcpOptions",
              "ec2:DescribeNetworkInterfaces",
              "ec2:DeleteNetworkInterface",
              "ec2:DescribeSubnets",
              "ec2:DescribeSecurityGroups",
              "ec2:DescribeVpcs",
              "ec2:CreateNetworkInterfacePermission",

              // Required to run `aws ecs update-service`
              "ecs:UpdateService"
            ],
            "Resource": [
              "*",
            ]
          }
        ]
      })
    })

    const customCodebuildPolicyAttachment = new iam.IamRolePolicyAttachment(this, "codebuildServiceRoleRolePolicyAttachment", {
      role: codebuildServiceRole.name,
      policyArn: codebuildServiceRolePolicy.arn,
    })

    const ecrCodebuildPolicyAttachment = new iam.IamRolePolicyAttachment(this, "codebuildServiceRoleRolePolicyAttachmentAmazonEC2ContainerRegistryFullAccess", {
      role: codebuildServiceRole.name,
      policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess",
    })

    // https://docs.aws.amazon.com/codebuild/latest/userguide/auth-and-access-control-iam-identity-based-access-control.html#admin-access-policy
    const adminCodebuildPolicyAttachment = new iam.IamRolePolicyAttachment(this, "codebuildServiceRoleRolePolicyAttachmentAWSCodeBuildAdminAccess", {
      role: codebuildServiceRole.name,
      policyArn: "arn:aws:iam::aws:policy/AWSCodeBuildAdminAccess",
    })

    // @ts-ignore
    const project = new codebuild.CodebuildProject(this, "project", {
      dependsOn: [customCodebuildPolicyAttachment, ecrCodebuildPolicyAttachment, adminCodebuildPolicyAttachment],
      name: `${name}-build-pipeline`,
      serviceRole: codebuildServiceRole.arn,
      artifacts: { type: "NO_ARTIFACTS" },
      environment: {
        computeType: 'BUILD_GENERAL1_SMALL', // https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html
        type: 'LINUX_CONTAINER', // https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html
        image: 'aws/codebuild/amazonlinux2-x86_64-standard:3.0', // https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-available.html
        imagePullCredentialsType: "CODEBUILD", // https://docs.aws.amazon.com/codebuild/latest/userguide/create-project-cli.html#cli.environment.imagepullcredentialstype
        privilegedMode: true, // Needed to build Docker images
      },
      source: {
        type: "GITHUB",
        location: `https://github.com/${config.repository}.git`,
        gitCloneDepth: 1, // Only get the latest revision
        gitSubmodulesConfig: {
          fetchSubmodules: true,
        },
        reportBuildStatus: true,
        // Available Environment Variables - https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html
        buildspec: '',
      },
      vpcConfig: {
        vpcId: config.vpcId,
        securityGroupIds: [config.appSecurityGroup.securityGroupIdOutput],
        subnets: config.appSubnets || [],
      }
    })

    new codebuild.CodebuildWebhook(this, "webhook", {
      projectName: project.name,
      buildType: "BUILD",
      filterGroup: [{
          filter: [ 
              {
                type: "EVENT",
                pattern: "PUSH",
              },
              {
                type: "HEAD_REF",
                pattern: config.branch,
              },
          ],
      }],
    })

    new TerraformOutput(this, "lbDnsName", {
      value: loadBalancer.dnsName,
    });
  }
}
