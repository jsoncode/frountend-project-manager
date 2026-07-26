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
    const getSnapshot = useCallback(() => {
      const s = getState()
      return selectorRef.current ? selectorRef.current(s) : s
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
