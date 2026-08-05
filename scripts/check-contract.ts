import { checkCurrentCodexContract } from "../src/compatibility.js";

const result = await checkCurrentCodexContract();
console.log(JSON.stringify(result, null, 2));
if (!result.compatible) process.exitCode = 1;
