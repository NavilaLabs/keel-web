import type { PermissionDecision, PermissionRequest, RequestId } from '@keel-web/protocol'
import type { CreatePermissionGate, PermissionGate } from './types.js'

interface HeldCall {
  request: PermissionRequest
  settle: (decision: PermissionDecision) => void
}

function denial(message: string): PermissionDecision {
  return { decision: 'deny', message }
}

export const createPermissionGate: CreatePermissionGate = (): PermissionGate => {
  const held = new Map<RequestId, HeldCall>()
  let closed = false

  function release(requestId: RequestId, decision: PermissionDecision): boolean {
    const call = held.get(requestId)
    if (call === undefined) return false
    held.delete(requestId)
    call.settle(decision)
    return true
  }

  return {
    hold(request, signal) {
      if (closed) {
        return Promise.resolve(denial('The session was closed before this call was answered.'))
      }
      if (signal.aborted) {
        return Promise.resolve(denial('The call was aborted before it was answered.'))
      }

      return new Promise<PermissionDecision>((resolve) => {
        const onAbort = () => {
          release(request.requestId, denial('The call was aborted before it was answered.'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        held.set(request.requestId, {
          request,
          settle: (decision) => {
            signal.removeEventListener('abort', onAbort)
            resolve(decision)
          },
        })
      })
    },

    answer(requestId, decision) {
      return release(requestId, decision)
    },

    pending() {
      return [...held.values()].map((call) => call.request)
    },

    close() {
      closed = true
      for (const requestId of [...held.keys()]) {
        release(requestId, denial('The session was closed before this call was answered.'))
      }
    },
  }
}
