import { readdir } from 'node:fs/promises';

async function check() {
    try {
        const path = "c:\\Users\\Mathis\\Documents\\Project\\myflix\\server\\movies\\Spider-Man - No Way Home (2021)";
        const files = await readdir(path);
        console.log("Local Files:", files);
    } catch (e) {
        console.log("Local path failed:", e.message);
    }
}
check();
