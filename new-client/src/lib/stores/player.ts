import { writable } from 'svelte/store';

export interface PlayerState {
    isActive: boolean;
    mediaId: number | null;
    streamUrl: string | null;
    title: string | null;
    poster: string | null;
}

export const player = writable<PlayerState>({
    isActive: false,
    mediaId: null,
    streamUrl: null,
    title: null,
    poster: null
});

export function playMedia(media: { id: number; title: string; poster_path?: string }, url: string) {
    player.set({
        isActive: true,
        mediaId: media.id,
        streamUrl: url,
        title: media.title,
        poster: media.poster_path || null
    });
}

export function openPlayer(url: string, title: string, id: number | null = null) {
    player.set({
        isActive: true,
        mediaId: id,
        streamUrl: url,
        title: title,
        poster: null
    });
}

export function closePlayer() {
    player.update(s => ({
        ...s,
        isActive: false,
        // Keep last played info? No, reset for clean state
        streamUrl: null 
    }));
}
