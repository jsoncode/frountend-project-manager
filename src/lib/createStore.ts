import { useCallback, useRef, useSyncExternalStore } from 'react'

type Listener = () => void
type SetState<T> = (
  partial: Partial<T> | ((state: T) => Partial<T>),
) => void
type GetState<T> = () => T
type StateCreator<T> = (set: SetState<T>, get: GetState<T>) => T

export type StoreApi<T> = {
  getState: GetState<T>
  setState: SetState<T>
  subscribe: (listener: Listener) => () => void
}

/**
 * Tiny Zustand-compatible store (no zustand dependency).
 * Durable data still lives in the Tauri SQLite backend via invoke.
 */
export function createStore<T extends object>(
  creator: StateCreator<T>,
): {
  (): T
  <U>(selector: (state: T) => U): U
  getState: GetState<T>
  setState: SetState<T>
  subscribe: (listener: Listener) => () => void
} {
  let state: T
  const listeners = new Set<Listener>()

  const getState: GetState<T> = () => state
  const setState: SetState<T> = (partial) => {
    const nextPartial =
      typeof partial === 'function' ? partial(state) : partial
    // Skip notifying when every provided key is Object.is-equal to the current
    // value — unconditional notifications force needless re-renders and, with
    // an uncached selector, risk render loops (audit P2-2).
    let changed = false
    for (const key in nextPartial) {
      if (
        !Object.is(
          (state as Record<string, unknown>)[key],
          (nextPartial as Record<string, unknown>)[key],
        )
      ) {
        changed = true
        break
      }
    }
    if (!changed) return
    state = { ...state, ...nextPartial }
    listeners.forEach((l) => l())
  }

  state = creator(setState, getState)

  const subscribe = (listener: Listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function useStore(): T
  function useStore<U>(selector: (state: T) => U): U
  function useStore<U>(selector?: (state: T) => U): T | U {
    const selectorRef = useRef(selector)
    selectorRef.current = selector
    // Cache the selector result keyed by the state object reference. Without
    // this, `useStore((s) => s.x.filter(...))` returns a fresh array on every
    // getSnapshot call and drives React into an infinite render loop (the
    // zustand useSyncExternalStoreWithSelector pattern, audit P2-2).
    const cachedInputRef = useRef<unknown>(null)
    const cachedValueRef = useRef<unknown>(null)
    const getSnapshot = useCallback(() => {
      const s = getState()
      if (!selectorRef.current) return s
      if (cachedInputRef.current !== s) {
        cachedInputRef.current = s
        cachedValueRef.current = selectorRef.current(s)
      }
      return cachedValueRef.current as U
    }, [])
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }

  useStore.getState = getState
  useStore.setState = setState
  useStore.subscribe = subscribe

  return useStore
}

/** Alias matching `import { create } from 'zustand'` usage. */
export const create = createStore
