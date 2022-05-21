import { App, Fn } from "cdktf";
import BaseStack from "./base";
import PetAppStack from "./contrib/PetApp"

const app = new App(); 
const devBase = new BaseStack(app, "buildit-agency-dev-base", {
    cidr: '10.1.0.0/16',
    profile: "manning.idp.dev", // Specify AWS named profile
});
new PetAppStack(app, "petapp", {
    profile: "manning.idp.dev", // Specify AWS named profile
    vpcId: devBase.vpc.vpcIdOutput,
    publicSecurityGroup: devBase.publicSecurityGroup,
    appSecurityGroup: devBase.appSecurityGroup,
    publicSubnets: Fn.tolist(devBase.vpc.publicSubnetsOutput),
    appSubnets: Fn.tolist(devBase.vpc.privateSubnetsOutput),
    ecsClusterName: devBase.ecsCluster.name,
    repository: "TalHibner-manninglp/petapp", // Specify Git repository for PetApp
    branch: "main", // Specify the branch to build from
  })
app.synth();