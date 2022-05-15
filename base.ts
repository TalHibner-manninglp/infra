import { Construct } from "constructs";
import { Fn, TerraformStack } from "cdktf";
import { AwsProvider, iam, ecs, dynamodb, ec2, ssm } from "@cdktf/provider-aws";
import { Vpc } from "./.gen/modules/vpc";
import { SecurityGroup } from "./.gen/modules/security-group";

interface BaseStackConfig {
  cidr: string;
  profile: string;
}

export default class BaseStack extends TerraformStack {
  public readonly vpc: Vpc;
  public readonly publicSecurityGroup: SecurityGroup;
  public readonly appSecurityGroup: SecurityGroup;
  public readonly dataSecurityGroup: SecurityGroup;
  public readonly ecsCluster: ecs.EcsCluster;
  public readonly dynamoDBTable: dynamodb.DynamodbTable;
  constructor(scope: Construct, name: string, config: BaseStackConfig) {
    super(scope, name);

    new AwsProvider(this, "agency.dev", {
      region: "us-east-1",
      profile: config.profile,
    });

    const vpc = new Vpc(this, "buildit-agency-dev-ue1-main", {
      name: 'buildit-agency-dev-ue1-main',
      cidr: config.cidr,
      azs: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
      publicSubnets: ['10.1.0.0/24', '10.1.1.0/24', '10.1.2.0/24'],
      privateSubnets: ['10.1.4.0/24', '10.1.5.0/24', '10.1.6.0/24'],
      databaseSubnets: ['10.1.8.0/24', '10.1.9.0/24', '10.1.10.0/24'],
      enableNatGateway: true,
      oneNatGatewayPerAz: true,
      createIgw: true,
    })

    const securityGroups: { [key: string]: SecurityGroup } = {};

    securityGroups.public = new SecurityGroup(this, "public", {
      name: "public",
      vpcId: vpc.vpcIdOutput,
      egressWithSelf: [{ rule: "all-all" }],
      egressCidrBlocks: ["0.0.0.0/0"],
      egressRules: ["all-all"],
      ingressWithSelf: [{ rule: "all-all" }],
      ingressRules: ["http-80-tcp","https-443-tcp"],
      ingressCidrBlocks: ["0.0.0.0/0"],
    })

    securityGroups.app = new SecurityGroup(this, "app", {
      name: "app",
      vpcId: vpc.vpcIdOutput,
      ingressWithSelf: [{ rule: "all-all" }],
      egressWithSelf: [{ rule: "all-all" }],
      egressCidrBlocks: ["0.0.0.0/0"],
      egressRules: ["all-all"],
      computedIngressWithSourceSecurityGroupId: [{
        "rule": "all-all",
        "source_security_group_id": securityGroups.public.securityGroupIdOutput,
      }],
      numberOfComputedIngressWithSourceSecurityGroupId: 1,
    })

    securityGroups.data = new SecurityGroup(this, "data", {
      name: "data",
      vpcId: vpc.vpcIdOutput,
      ingressWithSelf: [{ rule: "all-all" }],
      egressWithSelf: [{ rule: "all-all" }],
      egressCidrBlocks: ["0.0.0.0/0"],
      egressRules: ["all-all"],
      computedIngressWithSourceSecurityGroupId: [{
        "rule": "all-all",
        "source_security_group_id": securityGroups.app.securityGroupIdOutput,
      }],
      numberOfComputedIngressWithSourceSecurityGroupId: 1,
    })

    new iam.IamServiceLinkedRole(this, "ecs", {
      awsServiceName: "ecs.amazonaws.com",
    })

    const ecsCluster = new ecs.EcsCluster(this, "ecs-cluster-main", {
      name: "main",
    })

    new ecs.EcsClusterCapacityProviders(this, "ecs-capacity-provider-main", {
      clusterName: ecsCluster.name,
      capacityProviders: ["FARGATE"]
    })

    const dynamoDBTable = new dynamodb.DynamodbTable(this, `${name}-idp-environment`, {
      name: 'my-first-table',
      billingMode: "PAY_PER_REQUEST",
      hashKey: 'environment',
      attribute: [{ name: 'environment', type: 'S' }],
    })

    const amiId = new ssm.DataAwsSsmParameter(this, 'latest-amazon-linux-2-ami-id', {
      name: '/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2'
    })

    // There's an undocumented 'bug' where you can't launch more than 2 ECS tasks unless you've launched an EC2 instance
    // If you try, you'll see the error "You've reached the limit on the number of tasks you can run concurrently"
    // This instance is created to avoid this error
    // It should qualify for the free tier
    new ec2.Instance(this, 'activation', {
      ami: amiId.value,
      instanceType: 't2.micro', // If `t2.micro` is not available in your region, choose `t3.micro` to keep using the Free Tier,
      associatePublicIpAddress: false,
      subnetId: Fn.element(Fn.tolist(vpc.privateSubnetsOutput), 0),
    })

    this.vpc = vpc;
    this.publicSecurityGroup = securityGroups.public;
    this.appSecurityGroup = securityGroups.app;
    this.dataSecurityGroup = securityGroups.data;
    this.ecsCluster = ecsCluster;
    this.dynamoDBTable = dynamoDBTable;
  }
}