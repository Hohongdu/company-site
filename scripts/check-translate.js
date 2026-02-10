const axios = require('axios');

const url = process.argv[2] || 'http://localhost:3000/api/translate';

async function run() {
    try {
        const { data } = await axios.post(url, {
            q: '안녕하세요',
            source: 'ko',
            target: 'en',
            format: 'text',
        });

        console.log('ok:', data);
    } catch (error) {
        const status = error?.response?.status;
        const body = error?.response?.data;
        console.error('failed:', { status, body, message: error.message });
        process.exit(1);
    }
}

run();
