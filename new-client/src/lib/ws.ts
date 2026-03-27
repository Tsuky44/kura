import { get } from 'svelte/store';
import { apiUrl } from './api';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// Current playback state to sync
let currentMediaId: number | null = null;
let currentTime: number = 0;
let isEpisode: boolean = false;

/**
 * Connect to the server's WebSocket endpoint.
 * Auto-reconnects on disconnect with exponential backoff.
 */
export function connectWS() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return; // Already connected
    }

    const httpUrl = get(apiUrl).replace(/\/$/, '');
    const wsUrl = httpUrl.replace(/^http/, 'ws') + '/ws/player';

    try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('[WS] Connected to', wsUrl);
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        };

        socket.onclose = (e) => {
            console.log('[WS] Disconnected:', e.code, e.reason);
            socket = null;
            // Reconnect after 3s
            if (!reconnectTimer) {
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    connectWS();
                }, 3000);
            }
        };

        socket.onerror = (e) => {
            console.error('[WS] Error:', e);
        };

        socket.onmessage = (e) => {
            // Server could send commands in the future (e.g. pause from admin)
            console.log('[WS] Message:', e.data);
        };
    } catch (e) {
        console.error('[WS] Failed to create WebSocket:', e);
    }
}

/**
 * Disconnect from the WebSocket and stop syncing.
 */
export function disconnectWS() {
    stopSync();
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (socket) {
        socket.close();
        socket = null;
    }
}

/**
 * Send a message through the WebSocket.
 */
function send(data: Record<string, unknown>) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

/**
 * Start syncing playback progress every 5 seconds.
 * Called when playback begins.
 */
export function startSync(mediaId: number, episode: boolean = false) {
    stopSync(); // Clear any existing sync
    currentMediaId = mediaId;
    isEpisode = episode;

    // Ensure we're connected
    connectWS();

    syncInterval = setInterval(() => {
        if (currentMediaId !== null && currentTime > 0) {
            const payload: Record<string, unknown> = {
                action: 'SYNC_TIME',
                time: currentTime
            };

            if (isEpisode) {
                payload.episodeId = currentMediaId;
            } else {
                payload.movieId = currentMediaId;
            }

            send(payload);
        }
    }, 5000); // Every 5 seconds
}

/**
 * Stop syncing playback progress.
 * Called when playback ends.
 */
export function stopSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    // Send final sync before stopping
    if (currentMediaId !== null && currentTime > 0) {
        const payload: Record<string, unknown> = {
            action: 'SYNC_TIME',
            time: currentTime
        };
        if (isEpisode) {
            payload.episodeId = currentMediaId;
        } else {
            payload.movieId = currentMediaId;
        }
        send(payload);
    }
    currentMediaId = null;
    currentTime = 0;
}

/**
 * Update the current playback time.
 * Called from the Player component on every time update.
 */
export function updateSyncTime(time: number) {
    currentTime = time;
}

/**
 * Send a pause event to the server.
 */
export function sendPause() {
    send({ action: 'PAUSE' });
}
