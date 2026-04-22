import { useEffect, useReducer, useCallback, useRef } from 'react';
import type { LiveFeedEvent } from '../types';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface State {
  visible: LiveFeedEvent[];
  buffer: LiveFeedEvent[];
  paused: boolean;
  connectionState: ConnectionState;
}

type Action =
  | { type: 'event'; event: LiveFeedEvent }
  | { type: 'toggle_pause' }
  | { type: 'load_more' }
  | { type: 'set_connection'; state: ConnectionState };

const MAX_VISIBLE = 200;
const LOAD_MORE_BATCH = 20;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'event':
      if (state.paused) {
        return { ...state, buffer: [action.event, ...state.buffer] };
      }
      return {
        ...state,
        visible: [action.event, ...state.visible].slice(0, MAX_VISIBLE),
      };

    case 'toggle_pause':
      if (state.paused) {
        // Resuming — flush buffer into visible
        return {
          ...state,
          paused: false,
          visible: [...state.buffer, ...state.visible].slice(0, MAX_VISIBLE),
          buffer: [],
        };
      }
      return { ...state, paused: true };

    case 'load_more':
      return {
        ...state,
        visible: [
          ...state.buffer.slice(0, LOAD_MORE_BATCH),
          ...state.visible,
        ].slice(0, MAX_VISIBLE),
        buffer: state.buffer.slice(LOAD_MORE_BATCH),
      };

    case 'set_connection':
      return { ...state, connectionState: action.state };
  }
}

const INITIAL: State = {
  visible: [],
  buffer: [],
  paused: false,
  connectionState: 'connecting',
};

export function useLiveFeed(shopId: string) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  // Stable ref so the SSE callback always reads the current paused state
  const pausedRef = useRef(state.paused);
  pausedRef.current = state.paused;

  useEffect(() => {
    if (!shopId) return;

    let es: EventSource;
    let retryTimer: ReturnType<typeof setTimeout>;
    let retryDelay = 1000;
    let mounted = true;

    function connect() {
      dispatch({ type: 'set_connection', state: 'connecting' });
      es = new EventSource(`/api/feed/${encodeURIComponent(shopId)}`);

      es.onopen = () => {
        if (!mounted) return;
        dispatch({ type: 'set_connection', state: 'connected' });
        retryDelay = 1000;
      };

      es.onmessage = (e) => {
        if (!mounted) return;
        try {
          const event = JSON.parse(e.data as string) as LiveFeedEvent;
          if (event.type === 'connected') return;
          dispatch({ type: 'event', event });
        } catch {
          // malformed JSON — ignore
        }
      };

      es.onerror = () => {
        if (!mounted) return;
        dispatch({ type: 'set_connection', state: 'disconnected' });
        es.close();
        retryTimer = setTimeout(() => {
          if (mounted) connect();
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }, retryDelay);
      };
    }

    connect();

    return () => {
      mounted = false;
      clearTimeout(retryTimer);
      es?.close();
    };
  }, [shopId]);

  const togglePause = useCallback(() => dispatch({ type: 'toggle_pause' }), []);
  const loadMore = useCallback(() => dispatch({ type: 'load_more' }), []);

  return {
    events: state.visible,
    paused: state.paused,
    bufferedCount: state.buffer.length,
    connectionState: state.connectionState,
    togglePause,
    loadMore,
  };
}
