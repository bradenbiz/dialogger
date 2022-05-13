import { client } from '$lib/api';

export const post = async (event) => {
    const body = await event.request.text();
    const res = await client().classifyText({document: {type: 'PLAIN_TEXT', content: 'How are you doing today? My shoulder hurts but I am doing alright. Thank you for asking.'}});
    return { body: res };
}