import { writable } from 'svelte/store';

export interface PlayerState {
    isActive: boolean;
    mediaId: number | null;
    streamUrl: string | null;
    title: string | null;
    poster: string | null;
    resumeTime: number;
}

export const player = writable<PlayerState>({
    isActive: false,
    mediaId: null,
    streamUrl: null,
    title: null,
    poster: null,
    resumeTime: 0
});

export function playMedia(media: { id: number; title: string; poster_path?: string; progress?: number }, url: string) {
    player.set({
        isActive: true,
        mediaId: media.id,
        streamUrl: url,
        title: media.title,
        poster: media.poster_path || null,
        resumeTime: media.progress || 0
    });
}

export function openPlayer(url: string, title: string, id: number | null = null, resumeTime: number = 0) {
    player.set({
        isActive: true,
        mediaId: id,
        streamUrl: url,
        title: title,
        poster: null,
        resumeTime
    });
}

export function closePlayer() {
    player.update(s => ({
        ...s,
        isActive: false,
        streamUrl: null,
        resumeTime: 0
    }));
}
