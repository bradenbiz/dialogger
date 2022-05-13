import { client } from '$lib/api';

export const post = async (event) => {
    const body = await event.request.text();
    const res = await client().analyzeEntities({document: {type: 'PLAIN_TEXT', content: body}});
    return { body: res };
}