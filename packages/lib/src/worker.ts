import type { IProcMap, WorkerParentMessage } from "./types"
import {
  customGenerator,
  deserializeProcMap,
  getProc,
  getProcMapScope,
} from "./worker-funcs.js"

let didInit = false
let procMap: IProcMap = {}
let generatedFnMap: { [key: string]: string } = {}

onmessage = async (e) => {
  if (!e.data) return
  if (!didInit) {
    procMap = deserializeProcMap(e.data)
    didInit = true
    postMessage("initialized")
    return
  }

  const { id, path, args } = e.data as WorkerParentMessage
  if ("yield" in e.data) return
  if ("result" in e.data) return

  const scope = path.includes(".") ? getProcMapScope(procMap, path) : procMap

  try {
    // @ts-expect-error
    globalThis.reportProgress = (progress: number) =>
      postMessage({ id, progress })

    // @ts-expect-error
    globalThis._____yield = async (value: any) => {
      postMessage({ id, yield: value })

      return new Promise((resolve) => {
        const handler = async (event: MessageEvent) => {
          if (!("yield" in event.data) && !("result" in event.data)) return
          const { id: responseId, yield: yieldInputValue, result } = event.data
          if (responseId !== id) return

          removeEventListener("message", handler)
          if ("result" in event.data) return resolve(result)
          resolve(yieldInputValue)
        }

        addEventListener("message", handler)
      })
    }

    let fn = getProc(procMap, path)
    const toStringTag = (fn as any)[Symbol.toStringTag]
    const isGenerator = toStringTag?.endsWith("GeneratorFunction")

    if (isGenerator) {
      const genSrc =
        generatedFnMap[path] ??
        (generatedFnMap[path] = customGenerator(fn.toString()))

      let gfn = eval(`(${genSrc})`) as (...args: any[]) => any
      fn = gfn
    }

    const result = await fn.bind(scope)(...args)
    postMessage({ id, result })
  } catch (error) {
    postMessage({ id, error })
  }
}
