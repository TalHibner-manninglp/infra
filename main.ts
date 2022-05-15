import { App } from "cdktf";
import BaseStack from "./base";

const app = new App(); 
// @ts-ignore
const devBase = new BaseStack(app, "buildit-agency-dev-base", {
    cidr: '10.1.0.0/16',
    profile: "manning.idp.dev",
});
app.synth();