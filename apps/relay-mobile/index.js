import * as ExpoCrypto from "expo-crypto";
import { registerRootComponent } from "expo";

if (typeof global.crypto !== "object") {
  global.crypto = {};
}

if (typeof global.crypto.getRandomValues !== "function") {
  global.crypto.getRandomValues = ExpoCrypto.getRandomValues;
}

const App = require("./App").default;

registerRootComponent(App);
