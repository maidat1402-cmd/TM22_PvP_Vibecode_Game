# Lịch sử phiên bản

Số phiên bản nằm ở `shared/version.js` (hiện ở góc menu và trong bảng Esc của game). Quy tắc tăng số xem `AGENTS.md`, mục 1.

## 0.8.0 (2026-11-20)

- Chế độ **Đấu tập**: phòng có sẵn 2 bia tập + 1 võ sĩ máy, phím `P` (menu ☰ trên điện thoại) nạp đầy thanh dị biến.
- Dị biến v2, đợt 2 và đợt 3:
  - Homura: vệt lửa trên sàn (bước chạy, nhát chém, cú bổ), Hồi Nguyệt Viêm bay về như boomerang, Phượng Hoàng Niết Bàn làm mọi vệt lửa bùng thành cột lửa, hồi sinh 1 lần với 30% máu.
  - Kage: Phân Ảnh Mồi (2 phân thân giống hệt mình, trúng 1 đòn là tan), Hoán Ảnh đổi chỗ với phân thân, Vạn Ảnh Táng kèm sương đêm (đối thủ chỉ thấy người trong 6 m).
  - Yuki: sàn băng trơn trượt, Băng Tường đập vỡ được, Thời Băng Giới làm chậm người và đạn của đối thủ.
  - Raiga: giữ phím tụ khí (Tụ Khí Đạn, Bạo Long Chưởng), Bạo Trảo Quăng túm – quật – ném đối thủ.
  - Midori: cây bắn gai tự động, người cây Mộc Thần đi theo đánh hộ; hút máu giảm còn 12%.
- Người chơi giả do server điều khiển (bia tập, võ sĩ máy, phân thân, người cây), vùng trên sàn (lửa, băng, ngưng đọng), kiểm tra đồng minh chung `allied()`.

## 0.7.0 (2026-11-20) · `5d96fa7`

- Dị biến v2, đợt 1: Kaze, Shiden, Gantetsu có luật chơi riêng khi biến hình (bản thảo: `docs/ban-thao-di-bien-v2.md`).
  - Kaze: bay tự do không tốn mana (cao tối đa 10 m), nhận thêm 15% sát thương khi ở trên không; Phong Ảnh Bộ lướt 3 chiều + phân thân gió chém lại; tường gió đẩy bay lên; rồng lốc lái được độ cao.
  - Shiden: thương cắm thành cọc sét (tối đa 3), 2 cọc nối thành hàng rào điện; Lôi Độn dịch chuyển tới cọc; lưới sét và Thiên Lôi Phán Quyết phóng thêm từ từng cọc.
  - Gantetsu: Dựng Sơn Trụ (cột đá đứng lên được), Nhổ Sơn Thạch (nhổ cột lên ném), Địa Chấn Toàn Sân thay Thiên Thạch (nhảy lên để né).
- Hệ thống công trình dùng chung: vật có máu, đối thủ đánh phá được (gói `prop`).
- Hiện số phiên bản trong game; server báo khi trình duyệt đang chạy bản cũ.

## 0.6.0 (2026-11-20) · `b7fdd09`

- Thanh dị biến (100 điểm), biến hình 17 giây bằng `L` `L`, bộ 6 chiêu dị biến cho cả 8 nhân vật.
- Chiêu đánh xa ngắm được theo chiều dọc.

## 0.5.0 (2026-11-19) · `a3f585d`, `645a2b6`

- Bảng chỉ số và xem trước chiêu ở màn chọn nhân vật.
- Máu riêng cho từng nhân vật, chuỗi đòn J (đòn kết JJJ), cơ chế đặc trưng cho 4 nhân vật mới.

## 0.4.0 (2026-11-19) · `4310e10`

- Thêm 4 nhân vật: Shiden, Midori, Gantetsu, Kage.

## 0.3.0 (2026-11-19) · `e2f678e`, `d053c3a`

- Chế độ Đấu đội: phòng chờ, chọn đội, sẵn sàng, chủ phòng bắt đầu.
- Sửa lỗi nhân vật cũ còn ở lại phòng khi tải lại trang.

## 0.2.0 (2026-11-19) · `a4911c3`, `0005aa9`

- Thêm 3 map đối kháng: Đảo Đại Hội Võ Thuật, Hoang Mạc Đá Đỏ, Làng Ninja Rừng Trúc.

## 0.1.0 (2026-11-19) · `cdb1482`

- Bản đầu tiên: chế độ đối kháng chibi 3D (Kaze, Raiga, Homura, Yuki) và chế độ bắn súng (Đặt bom, Sinh tử).
