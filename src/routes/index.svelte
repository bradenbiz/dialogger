<script>
    let text = 'The quick brown fox jumped over the lazy dog.';

    const classify = async () => {
        const res = await fetch('/api/classify', {method: 'POST', body: text}).then(i => i.json());
        console.log('CLASSIFY', res);
    }

    const entities = async () => {
        const res = await fetch('/api/entities', {method: 'POST', body: text}).then(i => i.json());
        console.log('ENTRIES', res);
    }
</script>

<div class="w-screen h-screen flex items-center justify-center bg-gray-100">
    <div>
        <h1 class="font-light text-4xl text-orange-500 mb-3 text-center">Dialogger</h1>
        <div class="flex gap-3">
            <input class="w-96 border-orange-500 border rounded p-2" bind:value={text} type="text">
            <button on:click={classify} class="bg-orange-500 hover:bg-orange-600 rounded text-white py-2 px-5 font-light">
                Classify
            </button>
            <button on:click={entities} class="bg-orange-500 hover:bg-orange-600 rounded text-white py-2 px-5 font-light">
                Get Entities
            </button>
        </div>
    </div>
</div>

