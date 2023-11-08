import { isMainThread, workerData, parentPort } from "node:worker_threads";
import { customGenerator, deserializeProcMap, getProc, getProcMapScope, } from "./worker-funcs.js";
let generatedFnMap = {};
if (!isMainThread && parentPort) {
    const procMap = deserializeProcMap(workerData);
    const postMessage = (data) => parentPort?.postMessage({ data });
    parentPort.on("message", async (e) => {
        const { id, path, args } = e;
        if ("yield" in e)
            return;
        if ("result" in e)
            return;
        const scope = path.includes(".") ? getProcMapScope(procMap, path) : procMap;
        try {
            // @ts-expect-error
            globalThis.reportProgress = (progress) => postMessage({ id, progress });
            // @ts-expect-error
            globalThis._____yield = async (value) => {
                postMessage({ id, yield: value });
                return new Promise((resolve) => {
                    const handler = async (event) => {
                        if (!("yield" in event) && !("result" in event))
                            return;
                        const { id: responseId, yield: yieldInputValue, result } = event;
                        if (responseId !== id)
                            return;
                        parentPort?.removeListener("message", handler);
                        if ("result" in event)
                            return resolve(result);
                        resolve(yieldInputValue);
                    };
                    parentPort?.addListener("message", handler);
                });
            };
            let fn = getProc(procMap, path);
            const toStringTag = fn[Symbol.toStringTag];
            const isGenerator = toStringTag?.endsWith("GeneratorFunction");
            if (isGenerator) {
                const genSrc = generatedFnMap[path] ??
                    (generatedFnMap[path] = customGenerator(fn.toString()));
                let gfn = eval(`(${genSrc})`);
                fn = gfn;
            }
            const result = await fn.bind(scope)(...args);
            postMessage({ id, result });
        }
        catch (error) {
            postMessage({ id, error });
        }
    });
}
