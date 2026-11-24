# Lịch sử phiên bản

Số phiên bản nằm ở `shared/version.js` (hiện ở góc menu và trong bảng Esc của game). Quy tắc tăng số xem `AGENTS.md`, mục 1.

## 0.16.2 (2026-11-24)

- Tiến lên tiếp tục đánh sau khi có người về nhất. Chốt theo thứ tự hết bài và chuyển quyền hưởng sái khi người đã về thắng vòng.
- Tính xu theo hạng, cóng, thối heo và chặt chồng. Tới trắng chốt 40 xu mỗi ghế còn lại.

## 0.16.1 (2026-11-24)

- Bài trên tay Tiến lên hiển thị trực tiếp từ Canvas, mỗi mặt bài chỉ có một lớp hình.
- Tách tên phòng, đồng hồ và nút điều khiển trên màn hình hẹp để tránh chồng lên nhau.

## 0.16.0 (2026-11-24) · `7953b31`

- Chủ phòng Xì dách và Tiến lên chọn bộ bài Cổ điển hoặc Chibi Clash trong cài đặt bàn.
- Lá bài có bố cục dấu theo số, chỉ số ở hai góc và hình nhân vật J, Q, K với huy hiệu cùng màu chất bài.

## 0.15.1 (2026-11-24) · `686d586`

- Xì dách giữ chỗ 60 giây. Sau 20 giây mất mạng, máy rút hoặc dằn thay đến khi người chơi quay lại.
- Kết nối lại vẫn dùng được mã phiên đã lưu nếu đường truyền rớt trước khi nhận mã mới.
- Nhà cái quắc từ 28 điểm so bài bình thường. Khoản đền chỉ áp dụng giữa các ghế cược.

## 0.15.0 (2026-11-23) · `02330d4`

- Nhà cái Xì dách có thể mở từng ghế, chốt kết quả theo điểm lúc mở rồi rút thêm trước khi so với ghế khác.

## 0.14.1 (2026-11-23) · `2e265e1`

- Sau khi khôi phục phiên, chủ động rời bàn sẽ về sảnh. Tải lại tab từ đường dẫn vào nhanh cũng thử nhận lại ghế.

## 0.14.0 (2026-11-23) · `ea5b1b6`

- Chủ phòng tùy chỉnh vốn ban đầu trong hai chế độ bài và đặt tối đa năm mức cược trong Xì dách. Người mới vào bàn nhận vốn và mức cược theo cấu hình.

## 0.13.0 (2026-11-23) · `055a36e`

- Xì dách có tám ghế cược và một nhà cái. Người chơi quắc có thể giữ lượt và rút tiếp khi còn dưới 5 lá.
- Khi rút từ 28 điểm trở lên, người quắc đền mỗi ghế cược khác một lần mức cược của ghế đó. Bài quắc và khoản đền chỉ lộ khi so bài.

## 0.12.0 (2026-11-23) · `5380bbf`

- Bàn bài giữ ghế, bài, xu và vai trò trong 60 giây khi mất kết nối. Người chơi có thể lấy lại chỗ trong cùng tab.

## 0.11.7 (2026-11-23) · `0400b8c`

- Lướt né của Kaze dị biến cấp miễn sát thương theo đúng hồi chiêu trên màn hình.
- Khi bắt đầu hoặc kết thúc trận Đấu đội, dọn toàn bộ chiêu, hiệu ứng và vật cản tạm của trận cũ.

## 0.11.6 (2026-11-23)

- Bắn súng: đạn không còn tản loạn và tia đạn không lệch khi đang di chuyển; đi bộ (Shift) gần như không bị phạt độ tản.
- Sniper: phát thứ 2 trở đi không còn bay cao hơn tâm scope; server bù trễ theo ping (đo bằng ping/pong WebSocket) nên bắn trúng mục tiêu đang chạy khi mạng chậm, vẫn từ chối phát gian lận.
- Bắn súng không còn đứng hình khi biển tên đồng đội/đối thủ hiện ra.
- Server không còn văng (mọi người bị out) vì gói tin dị dạng.
- Chặn gói tin gian lận: máu thành NaN, tự hiện "đã chết", spam né để bất tử, chọn Mộc Thần / bia tập làm nhân vật (cả ở bàn bài).
- Nhịp tim đo RTT chính xác hơn.
- Rò rỉ bộ nhớ GPU ở súng, lựu đạn, súng rơi, map bắn súng, hiệu ứng chiêu; hiệu ứng và tia đạn dồn khi tab bị ẩn. Tab ẩn không còn làm mất cột đá, tường, vùng sàn của đối thủ.
- Đặt bom: một phe rời lúc chờ sang vòng thì về khởi động; thưởng nổ bom đúng phe; lựu đạn không nổ trúng đồng đội khi người ném đã rời.
- Đấu đội: chiêu còn sót được xoá khi bắt đầu/kết thúc trận; phân thân/người cây không tính là người của đội.
- Kẹt trạng thái ở client: chat trên điện thoại, xem người đã rời, nạp đạn, scope, bảng điểm; huỷ lướt/nhảy khi server từ chối chiêu.
- Cảm ứng: độ nhạy xoay camera không còn bị bình phương, đối kháng áp dụng đảo trục dọc. iPhone: có lại âm thanh sau cuộc gọi/chuyển app.
- Bớt tải GPU/DOM mỗi khung hình; làm nóng shader vòng phép 2 mặt và đá (cột đá, cọc sét) để lần dùng đầu không khựng.

## 0.11.5 (2026-11-23) · `82d1447`

- Giải phóng tài nguyên riêng của mô hình và lá bài khi đổi nhân vật hoặc rời phòng để giảm tích lũy bộ nhớ đồ họa.

## 0.11.4 (2026-11-23) · `a4a28a0`

- Nút Kết nối lại thử vào phòng vừa chơi nếu phòng còn trên server.

## 0.11.3 (2026-11-23) · `6c1b3e8`

- Tiến lên hiển thị trạng thái bỏ lượt của cả người thật lẫn máy.

## 0.11.2 (2026-11-23) · `b8b375d`

- Hub cấp UUID cho mọi phòng, giúp link mời luôn trỏ tới đúng phòng đang chơi.

## 0.11.1 (2026-11-23) · `6e406c7`

- Máy chủ kiểm tra URL và tọa độ phát bắn trước khi đọc tệp, trừ đạn hoặc gửi hiệu ứng.

## 0.11.0 (2026-11-23) · `d8f71f0`

- Đánh bài: **phòng chờ** thay cho vào là chia bài ngay. Người chơi bấm **✔ Sẵn sàng**, chủ phòng 👑 bấm **▶ Bắt đầu** khi mọi người đã sẵn sàng; nút **⏸** của chủ phòng hẹn dừng sau ván đang chơi để về lại phòng chờ. Chủ phòng rời bàn thì người vào sớm nhất thành chủ phòng.
- Xì dách: chủ phòng chọn **ai làm nhà cái** trong phòng chờ, mình hoặc máy. Chủ phòng làm nhà cái thì tự rút / dằn (đủ 15 điểm, 20 giây, hết giờ máy đánh thay) và ăn / chung tiền với cả bàn.

- Đánh bài: nút **🤖 − / +** chọn số máy (AI) chơi cùng để chơi một mình (Xì dách 0–4 máy, chỉ mình với nhà cái cũng được; Tiến lên 1–3 máy).
- Tiến lên: **tới trắng** (tứ quý heo, sảnh rồng, 6 đôi, 5 đôi thông) thắng ngay khi chia; **thối heo** phạt thêm khi còn lá 2 lúc hết ván (heo đen 20 xu, heo đỏ 40 xu mỗi lá).

## 0.10.0 (2026-11-23) · `58e7f7e`

- Menu "Vào phòng" chia chế độ theo danh mục: ⚔ Chiêu thức · 🔫 Bắn súng · 🃏 Đánh bài.
- Chế độ **đánh bài** mới: các nhân vật ngồi quanh bàn tròn 3D, lá bài (vẽ bằng canvas) được chia, đánh ra và nằm trên bàn.
  - **Xì dách**: đấu nhà cái, đặt cược, rút / dằn (đủ 16 điểm), xì bàng, xì dách, ngũ linh, quắc.
  - **Tiến lên miền Nam**: 4 người, rác / đôi / sám / tứ quý / sảnh / đôi thông, chặt heo, lượt đầu có 3♠, gợi ý nước đi, trả tiền theo lá còn lại (cháy ×2).
  - Bot tự ngồi ghế trống và chơi thay người rời bàn; chơi được trên điện thoại (nút bấm, màn dọc).
- Thêm `tests/cards.mjs`.

## 0.9.0 (2026-11-23) · `9936d83`

- Chiêu thức rõ và đã mắt hơn:
  - Khựng hình 50–100 ms khi trúng đòn mạnh (mình đánh hoặc bị đánh), góc nhìn camera rộng ra thoáng chốc khi bung tuyệt kỹ / nổ lớn.
  - Tuyệt kỹ nổ thành cột năng lượng cao 9 m, vết cháy và vết nứt phát sáng nằm lại trên sàn 3 giây, khói tối dâng lên, đá vụn bắn tung, 2 lớp sóng xung kích.
  - Pha tụ lực tuyệt kỹ: màn hình tối dần, chỉ chừa sáng quanh người ra chiêu; lúc bung chiêu chớp nhanh màu của chiêu. Tuyệt kỹ thường cũng có vòng tụ lực.
  - Lõi shader và hạt pha màu chính của chiêu thay vì trắng: chói theo màu, không trắng bệch.
- Bắt buộc nhập tên người chơi (2–16 ký tự) trước khi vào / tạo phòng hoặc mở link mời; bỏ tên tự sinh "NinjaXXX". Link có thể gắn sẵn tên bằng `?name=`.
- Nền menu đổi theo chế độ và map đang chọn (4 map đối kháng, 2 map bắn súng), camera bay vòng theo cỡ map; trước đây luôn là Đền Anh Đào.
- **Gán phím** (Cài đặt → ⌨ Gán phím): đổi phím cho từng hành động ở cả 2 chế độ, mỗi hành động 2 phím (bàn phím hoặc chuột), tự gỡ phím trùng, khôi phục mặc định, lưu trong trình duyệt. Thanh chiêu, danh sách chiêu, hướng dẫn F1 và thông báo hiện đúng phím đã gán.
- Màn chọn nhân vật: nút **!** ở mỗi dòng chiêu mở mô tả chiêu (cách hoạt động, cơ chế riêng, sát thương, tầm, hồi chiêu, mana, khống chế), sinh tự động từ dữ liệu chiêu.
- Màn chọn nhân vật: có bia tập đứng đúng tầm, nhận đòn theo từng chiêu (số sát thương, bị đẩy / kéo / hất tung, choáng, làm chậm).
- Bia ở chế độ Đấu tập đổi thành người rơm có hồng tâm.
- Camera không còn chui vào cột / hộp / chướng ngại vật (trước đây che mất nửa màn hình ở map Đền Anh Đào).
- Sửa hiệu ứng làm trắng xoá màn hình (đo bằng cách tung lần lượt 96 chiêu của 8 nhân vật, chất lượng cao và thấp):
  - Đèn chớp: giảm cường độ, đặt cao hơn mặt sàn, không bật chồng quá 2 đèn mạnh cùng lúc (trước đây mỗi gai trong chuỗi gai bật 1 đèn).
  - Vụ nổ: quầng sáng nhỏ và mờ hơn, quả cầu nổ càng to càng mờ.
  - Tia lửa trúng đòn, đấm loạn (Raiga), quả cầu Tinh Cầu Hủy Diệt, hiệu ứng gục ngã, băng vỡ cuối Thời Băng Giới: bớt sáng, bớt màu trắng.
- Sửa lỗi JS khi bộ chiêu đổi (biến hình / hết dị biến / đổi nhân vật) giữa lúc Raiga đang giữ phím tụ lực.

## 0.8.0 (2026-11-20) · `396794a`

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
