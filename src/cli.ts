#!/usr/bin/env node
import { main } from "./main.js";
import { productionDependencies } from "./production.js";

await main(productionDependencies());
