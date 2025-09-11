
/**
 * @fileoverview
 * This file defines a custom React hook, `useLocalStorage`, which provides a state
 * management mechanism similar to `useState`, but with the added functionality of
 * persisting the state to the browser's `localStorage`.
 *
 * It helps in retaining user data and preferences across browser sessions,
 * automatically syncing the state with `localStorage` whenever it changes.
 * The hook handles the serialization (JSON.stringify) and deserialization (JSON.parse)
 * of the stored data.
 */
import { useState, useEffect, Dispatch, SetStateAction, useCallback } from 'react';

// A wrapper around useState that persists the value to localStorage.
export function useLocalStorage<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  
  const readValue = useCallback((): T => {
    // Prevent build errors from trying to use localStorage on the server.
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key “${key}”:`, error);
      return initialValue;
    }
  }, [initialValue, key]);

  const [storedValue, setStoredValue] = useState<T>(readValue);

  const setValue: Dispatch<SetStateAction<T>> = (value) => {
    // Prevent build errors from trying to use localStorage on the server.
    if (typeof window == 'undefined') {
      console.warn(
        `Tried setting localStorage key “${key}” even though environment is not a client`
      );
    }

    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      // Save state
      setStoredValue(valueToStore);
      // Save to local storage
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn(`Error setting localStorage key “${key}”:`, error);
    }
  };

  useEffect(() => {
    setStoredValue(readValue());
  }, [readValue]);

  return [storedValue, setValue];
}
