// app.js

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 뷰 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));

// 임시 상품 데이터 (나중에 DB로 대체 예정)
const products = [
	{ id: 1, name: '상품 A', price: 19000, description: '기본 설명 텍스트입니다.', image: null },
	{ id: 2, name: '상품 B', price: 29000, description: '여기에 상품 특징 등을 적습니다.', image: null },
	{ id: 3, name: '상품 C', price: 39000, description: '나중에 실제 이미지 경로도 넣을 수 있어요.', image: null },
];

// 라우트
app.get('/', (req, res) => {
	res.render('index');
});

app.get('/about', (req, res) => {
	res.render('about');
});

app.get('/contact', (req, res) => {
	res.render('contact');
});

// 🔥 새로운 상품 목록 페이지
app.get('/products', (req, res) => {
	res.render('products', { products });
});

app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
