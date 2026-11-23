# Bản thảo: Dị biến v2, mỗi dạng biến hình đổi luôn cách chơi

> Trạng thái: **đã làm đủ 3 đợt**: đợt 1 ở 0.7.0 (Kaze, Shiden, Gantetsu), đợt 2 và đợt 3 ở 0.8.0 (Homura, Kage, Yuki, Raiga, Midori), kèm chế độ Đấu tập. Xem `CHANGELOG.md`.
> Mọi con số là điểm khởi đầu, đo lại bằng script cân bằng sau khi code.
> Nền hiện tại: dị biến v1 (commit `b7fdd09`). Thanh 100 điểm, biến hình 17 s, chết mất nửa thanh, kích hoạt bằng `L` `L`, tuyệt kỹ dị biến tụ lực lâu.

## 1. Vấn đề của v1

Khoảng một nửa số chiêu dị biến hiện tại chỉ là bản to hơn, mạnh hơn của chiêu thường. Người chơi biến hình xong vẫn bấm như cũ, chỉ thấy số to hơn. Ví dụ:

- Homura: Song Nguyệt Viêm = 2 trăng lửa thay vì 1.
- Yuki: Băng Quan ≈ Hàn Băng Kết Giới; Vĩnh Đông Giới ≈ Thiên Băng Vũ bám theo người.
- Shiden: 4/5 chiêu là bản cường hóa của chiêu thường.
- Gantetsu: Thiên Thạch Sơn Thần vẫn là một cú nhảy đập đất.
- Kage: Hóa Ảnh ≈ Ẩn Thân.

Những chiêu v1 đã tạo được cảm giác mới nên **giữ lại**: tường gió, rồng lốc (Kaze); lao tới đấm loạn (Raiga); vòng lửa bám người (Homura); trượt băng (Yuki); Thiên Lôi Phán Quyết (Shiden); thảm hoa, rừng gai (Midori); Thạch Lao (Gantetsu); phân thân chém theo, Vạn Ảnh Táng (Kage).

## 2. Nguyên tắc thiết kế v2

1. **Mỗi dạng có 1 "luật chơi riêng"**: một cơ chế chỉ tồn tại khi biến hình, và ít nhất 3/6 chiêu xoay quanh nó.
2. **Đối thủ phải có cách chống trả**: mỗi cơ chế ghi rõ mục *Cách đối phó*. Không có cơ chế nào chỉ "chịu trận".
3. **17 giây phải có cao trào**: chiêu cuối tụ lực 1.2–1.4 s, nhìn thấy được từ xa để đối thủ kịp phản ứng.
4. **Giữ ràng buộc dự án**: hình khối và hiệu ứng sinh bằng code, chạy được ở chất lượng `low`, có nút cảm ứng, không dùng hình ảnh của nhân vật có bản quyền.
5. **Cân bằng**: dạng dị biến mạnh hơn dạng thường khoảng 40–50% (sát thương/giây × máu), các nhân vật lệch nhau không quá ±15%.

Ký hiệu độ khó: 🟢 nhẹ (tái dụng code có sẵn), 🟡 vừa (thêm cơ chế mới ở 1 phía), 🔴 nặng (đồng bộ mạng phức tạp hoặc AI).

---

## 3. Đề xuất cho từng nhân vật

### 3.1 Kaze: Phong Thần Hóa, "Chủ nhân bầu trời" ✅ đã làm (0.7.0)

> Đã chốt: độ cao bay tối đa 10 m, đang ở trên không nhận thêm 15% sát thương. K giữ nguyên (ngắm dọc có sẵn đã cho phi tiêu chúi xuống mục tiêu).

**Luật chơi riêng: Bay tự do.** Giữ Space là bay, không tốn mana, tốc độ bay bằng tốc độ chạy. Mọi chiêu ra được giữa không trung. Chiêu bắn từ trên cao tự chúi xuống mục tiêu (đã có ngắm dọc).

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Phong Nhận: lưỡi gió bay | Giữ nguyên |
| K | Bão Phi Tiêu: 5 phi tiêu tự tìm | Giữ, nhưng khi đang bay thì phi tiêu rơi chéo xuống như mưa |
| JK | **Phong Ảnh Bộ** | Mới: lướt **3 chiều** theo tâm ngắm (lên, xuống, chéo). Đi xuyên qua đối thủ thì để lại một **phân thân gió** chém thêm 1 nhát sau 0.4 s |
| KL | Thiên Phong Bích: tường gió | Giữ. Thêm: đứng sau tường thì được đẩy bay lên (bệ phóng) |
| JKL | Phong Long Thiên Hành: cưỡi rồng lốc | Giữ. Thêm: rồng bay được lên cao rồi bổ nhào xuống theo tâm |
| JJJ | Phi Kunai Tuyệt Ảnh · Cực | Giữ |

- **Nội tại:** bay tự do; nhanh hơn 25%; lướt né hồi nhanh gấp đôi (đã có).
- **Cách đối phó:** khi đang bay, Kaze nhận thêm 15% sát thương. Chiêu ngắm dọc của đối thủ vẫn bắn trúng.
- **Kỹ thuật:** 🟢. Bay là cơ chế client đã có, chỉ cần bỏ tiêu hao mana khi `awakened()`; server nới giới hạn độ cao. Lướt 3D: thêm `dash.free3d` (dùng thành phần y của `aimDir`). Phân thân gió: tái dụng `echo` của Kage.
- **Câu hỏi mở:** có giới hạn độ cao không, ví dụ 12 m, để không bay ra khỏi tầm camera của đối thủ?

### 3.2 Raiga: Bạo Khí Thân, "Tụ khí bùng nổ" ✅ đã làm (0.8.0)

> Đã chốt: làm bản đầy đủ túm ném (server điều khiển vị trí nạn nhân 0.9 giây). Chưởng tụ tối đa 1.2 giây (×1.8), khí đạn tối đa 1.5 giây (×2.2).

**Luật chơi riêng: Giữ phím để tụ khí.** K và KL khi giữ phím thì tụ khí: giữ càng lâu (tối đa 1.5 s) đạn càng to, sát thương ×1 đến ×2.2, nhưng đứng yên khi tụ. Thả phím thì bắn.

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Khí Quyền: cú đấm bay 7 m | Giữ |
| K | **Tụ Khí Đạn** | Mới: chạm để bắn nhanh; giữ để tụ quả cầu lớn dần, nổ lan theo độ lớn |
| JK | **Bạo Trảo Quăng** | Mới: lao tới **túm** đối thủ đầu tiên trúng, nhấc lên quật xuống đất (choáng 0.6 s), rồi ném văng theo tâm ngắm |
| KL | Bạo Long Chưởng: chưởng quét theo tâm | Giữ, thêm: tụ lâu thì tia to hơn và dài hơn |
| JKL | Bách Liệt Bạo Quyền | Giữ (lao tới đấm loạn, nổ khí) |
| JJJ | Thăng Thiên Quyền · Cực | Giữ |

- **Nội tại:** không bị đẩy lùi, giảm 15% sát thương (đã có). Thêm: tụ khí tối đa thì cả người phát sáng; trúng đòn lúc đó không bị ngắt.
- **Cách đối phó:** đang tụ khí là đứng yên và phát sáng rõ, nên dễ bị né hoặc bị đánh úp. Túm bị chặn nếu đối thủ đang lướt né hoặc bất tử.
- **Kỹ thuật:**
  - Tụ khí 🟡: đổi cách bắt phím từ "bấm" sang "giữ rồi thả" cho K, KL khi dị biến. Client gửi `cast` kèm `hold` (0–1.5 s, server kiểm tra lại bằng thời điểm gửi gói `hold` bắt đầu). Nút cảm ứng đã hỗ trợ giữ.
  - Túm 🔴: server điều khiển vị trí nạn nhân trong 0.8 s (gói `grab` giống `tp` nhưng liên tục). Client nạn nhân phải tạm bỏ quyền tự di chuyển.
- **Phương án nhẹ hơn cho JK:** "Khí Chấn Quyền", đấm hất đối thủ lên cao rồi tự bay theo đấm thêm 1 nhịp trên không (chỉ dùng `kbUp` và dash có sẵn) 🟢.

### 3.3 Homura: Viêm Hoàng Giáp, "Biển lửa" ✅ đã làm (0.8.0)

> Đã chốt: giữ hồi sinh. Vệt lửa từ bước chạy, nhát chém J và cú bổ JK (K boomerang không để lửa).

**Luật chơi riêng: Đất cháy.** Mọi chiêu của Homura và cả bước chạy để lại **vệt lửa trên sàn** tồn tại 3 s. Đối thủ đứng trong vệt lửa bị bỏng (dùng lại nội tại bỏng v1). Homura đứng trên lửa thì hồi mana nhanh hơn.

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Viêm Hoàng Trảm: chém để lại lửa | Giữ, vệt lửa nằm lại trên sàn |
| K | **Hồi Nguyệt Viêm** | Mới: trăng lửa bay đi rồi **quay về như boomerang**, trúng được cả lượt đi lẫn lượt về |
| JK | Viêm Long Trụy: bay lên bổ xuống | Giữ, chỗ đáp thành vũng lửa lớn 4 m |
| KL | Hỏa Luân Trận: vòng lửa bám người | Giữ |
| JKL | **Phượng Hoàng Niết Bàn** | Đổi: phượng hoàng lao theo tâm, **mọi vệt lửa trên sàn bùng thành cột lửa** cùng lúc |
| JJJ | Viêm Long Toàn Trảm · Cực | Giữ |

- **Nội tại:** bỏng (đã có) + đất cháy. **Hồi sinh 1 lần**: nếu gục khi đang dị biến thì sống lại tại chỗ với 30% máu, kết thúc dị biến. Hồi sinh có thể bỏ nếu quá mạnh.
- **Cách đối phó:** vệt lửa nhìn thấy rõ, nhảy hoặc bay qua thì không bị bỏng. Biết Homura sẽ hồi sinh thì giữ chiêu mạnh lại cho lần thứ hai.
- **Kỹ thuật:** 🟢. Vệt lửa là danh sách vùng `{x, z, r, until}` ở server, kiểm tra mỗi tick (giống `trap` nhưng không bị xoá khi chạm). Client vẽ bằng một `InstancedMesh` decal để nhẹ ở `low`. Boomerang: thêm `return: true` cho projectile (đổi hướng ở nửa quãng đường). Hồi sinh: xử lý trong `kill()`.

### 3.4 Yuki: Băng Hậu, "Sân băng" ✅ đã làm (0.8.0)

> Đã chốt: trơn trượt chạy ở client, server không kiểm tra. Băng Tường chắn đạn của cả hai bên (cả Yuki).

**Luật chơi riêng: Biến sàn thành băng.** Chiêu của Yuki đóng băng mặt sàn (vùng tròn tồn tại 5 s). Đối thủ trên băng bị **trơn trượt**: quán tính lớn, khó dừng và đổi hướng, lướt né đi xa gấp đôi nhưng không kiểm soát được. Yuki trên băng thì trượt nhanh hơn 30%.

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Băng Tinh Đạn | Giữ, chỗ trúng đóng băng sàn nhỏ 1.5 m |
| K | Băng Thương Xuyên: 3 băng thương | Giữ |
| JK | Băng Hoạt Bộ: trượt băng | Giữ, đường trượt để lại vệt băng |
| KL | **Băng Tường** | Mới, thay Băng Quan: dựng tường băng cong 5 đoạn chắn đạn. Đối thủ **đập vỡ** được (mỗi đoạn 25 máu); vỡ thì bắn mảnh băng làm chậm |
| JKL | **Thời Băng Giới** | Mới, thay Vĩnh Đông Giới: vùng 10 m quanh Yuki trong 4 s, **đạn và người bay vào chậm 60%**, sàn trong vùng đóng băng toàn bộ, kết thúc bằng mưa băng |
| JJJ | Băng Phong Kích · Cực | Giữ |

- **Nội tại:** đóng băng khi trúng 3 đòn trong 3 s (đã có) + sàn băng.
- **Cách đối phó:** nhảy hoặc bay thì không bị trơn. Tường băng đập vỡ được. Thời Băng Giới tụ lực lâu, chạy ra khỏi vùng kịp thì thoát.
- **Kỹ thuật:**
  - Sàn trơn 🟡: vật lý di chuyển chạy ở client, nên client phải biết các vùng băng (server gửi gói `ice` khi tạo vùng, client tự kiểm tra). Người gian lận có thể bỏ qua hiệu ứng trơn, chấp nhận được vì chỉ là khống chế nhẹ.
  - Tường vỡ được 🟡: `dyn` có thêm `hp`, đạn trúng tường thì trừ máu tường, server gửi `dynhp`.
  - Làm chậm đạn trong vùng 🟡: đạn ở cả server lẫn client kiểm tra vùng, nhân `dt`.

### 3.5 Shiden: Lôi Kỵ Thần, "Lưới điện" ✅ đã làm (0.7.0)

> Khi làm: K bỏ sét nảy của v1 (Lôi Tiễn Liên Hoàn); không có cọc thì Lôi Độn dịch chuyển 10 m về phía trước thay vì lướt sét.

**Luật chơi riêng: Cọc sét.** K phóng thương sét cắm xuống đất thành **cọc** (tồn tại 8 s, tối đa 3 cọc). Hai cọc cách nhau dưới 10 m tự nối thành **hàng rào điện**: đối thủ đi xuyên qua bị sát thương và cộng dấu điện.

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Lôi Thần Thương: đâm 4.6 m | Giữ |
| K | **Lôi Trụ Thương** | Mới: phóng thương bay theo tâm; trúng người thì gây sát thương, không trúng thì cắm thành cọc ở chỗ rơi |
| JK | **Lôi Độn** | Mới: dịch chuyển tới cọc gần tâm ngắm nhất (không có cọc thì lướt sét như cũ), nổ sét nhỏ ở chỗ đến |
| KL | Lôi Võng Thiên La: lưới sét kéo vào giữa | Giữ, có cọc trong vùng thì lưới bám theo các cọc |
| JKL | Thiên Lôi Phán Quyết | Giữ. Thêm: **mọi cọc** cũng phóng sét vào đối thủ gần nó |
| JJJ | Lôi Thương Toàn Kích · Cực | Giữ |

- **Nội tại:** 2 dấu điện là sét nảy (đã có).
- **Cách đối phó:** cọc có 30 máu, đối thủ đánh phá được. Hàng rào điện nhìn thấy rõ, nhảy qua thì né được.
- **Kỹ thuật:** 🟢. Cọc tái dụng `trap` (tồn tại lâu, có giới hạn số lượng như Gieo Hạt của Midori). Hàng rào: mỗi tick kiểm tra người chơi cắt đoạn thẳng giữa 2 cọc. Dịch chuyển tới cọc: tái dụng `blink` tới dấu, như Thuấn Ảnh của Kage.

### 3.6 Midori: Hồn Rừng, "Khu vườn sống" ✅ đã làm (0.8.0)

> Đã chốt: làm bản đầy đủ người cây có AI (người chơi giả do server điều khiển). Hút máu giảm còn 12%.

**Luật chơi riêng: Triệu hồi đồng minh.** Midori không trực tiếp đánh mạnh hơn; sức mạnh nằm ở **cây** cô trồng ra.

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Gai Tiên Câu: roi gai kéo về | Giữ |
| K | Gai Hoa Nổ | Giữ |
| JK | **Trồng Gai Đài** | Mới, thay Cổ Thụ Căn: trồng **cây bắn gai** (tối đa 2, sống 10 s, 40 máu), tự bắn gai vào đối thủ gần nhất trong 12 m mỗi 0.8 s |
| KL | Hoa Viên Hồi Xuân: thảm hoa hồi máu | Giữ, cây trong thảm hoa cũng hồi máu |
| JKL | **Mộc Thần Hộ Vệ** | Mới, thay Vạn Gai Lâm: triệu hồi **người cây** cao 3 m đi theo Midori 10 s, đấm đối thủ gần, chặn đạn cho Midori |
| JJJ | Đằng Mạn Triền Thân · Cực | Giữ |

- **Nội tại:** hút máu 20% (đã có, có thể giảm còn 10% vì cây cũng gây sát thương).
- **Cách đối phó:** cây và người cây đánh phá được. Phá cây trước rồi mới đánh Midori.
- **Kỹ thuật:**
  - Cây bắn gai 🟡: `summon` đã có `obstacle`, `aura`; thêm `turret {range, every, skill}`, server chọn mục tiêu và bắn projectile có sẵn. Cần thêm máu cho vật triệu hồi.
  - Người cây 🔴: thực thể có AI (đi theo, chọn mục tiêu, đấm) chạy ở server, đồng bộ vị trí qua snapshot. Đây là "người chơi giả" đầu tiên trong game.
- **Phương án nhẹ hơn cho JKL:** "Cổ Thụ Thức Tỉnh", một cây khổng lồ mọc tại chỗ, đứng yên nhưng vươn 4 cành quật xung quanh 6 s (aoe nhiều nhịp + vật chắn) 🟢.

### 3.7 Gantetsu: Sơn Thần Giáp, "Nặn địa hình" ✅ đã làm (0.7.0)

> Khi làm: tầm nhổ cột 10 m (dựng cột xa tối đa 14 m); cột đá có 60 máu. Thạch Lao và Thiên Thạch của v1 đã bị thay.

**Luật chơi riêng: Cột đá.** Gantetsu dựng cột đá đứng lên được, rồi nhổ cột đá đó lên làm vũ khí.

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Chấn Sơn Quyền: đấm chấn động hình nón | Giữ |
| K | **Nhổ Sơn Thạch** | Mới: nhổ cột đá gần nhất (của mình, trong 6 m) ném theo tâm, to và mạnh hơn đá thường. Không có cột thì ném đá như cũ |
| JK | Sơn Thạch Cuộn: cuộn đá lăn | Giữ |
| KL | **Dựng Sơn Trụ** | Mới, thay Thạch Lao: dựng 1 cột đá cao 4 m ở tâm ngắm (tối đa 3, sống 10 s). Mọc ngay dưới chân đối thủ thì hất tung lên; mọc dưới chân mình thì nâng mình lên |
| JKL | **Địa Chấn Toàn Sân** | Mới, thay Thiên Thạch: tụ lực 1.4 s, dậm đất. **Mọi đối thủ đang đứng trên mặt đất** trong 25 m bị choáng 1.2 s và nhận sát thương; ai đang trên không thì né được. Các cột đá vỡ ra bắn mảnh |
| JJJ | Địa Liệt Quyền · Cực | Giữ |

- **Nội tại:** giảm 30% sát thương, không bị đẩy, không bị choáng (đã có).
- **Cách đối phó:** thấy Gantetsu tụ lực Địa Chấn (rung đất, vòng sáng lan rộng) thì **nhảy lên** đúng lúc. Đây là khoảnh khắc kịch tính cho cả phòng.
- **Kỹ thuật:** cột đá 🟢 (tái dụng `walls` / `stoneWalls` + `dyn` đứng lên được). Nhổ cột ném 🟡 (xoá `dyn` rồi tạo projectile từ vị trí cột). Địa chấn 🟢 (server đã biết `y` của người chơi, chỉ cần so với `arenaGround`).

### 3.8 Kage: Vạn Ảnh, "Thật giả lẫn lộn" ✅ đã làm (0.8.0)

> Đã chốt: Màn Đêm làm theo dạng sương mù: đối thủ chỉ thấy người và tên trong 6 m. Lớp sương nằm dưới HUD để vẫn đọc được thanh máu.

**Luật chơi riêng: Phân thân mồi.** Kage thả phân thân giống hệt mình (cùng tên, cùng thanh máu trên đầu). Đối thủ không phân biệt được, chiêu tự khoá có thể nhắm nhầm vào phân thân.

| Phím | Chiêu | Thay đổi so với v1 |
|---|---|---|
| J | Vạn Ảnh Trảm: chém + 2 phân thân chém theo | Giữ |
| K | Ảnh Đao Vũ: mưa phi đao | Giữ |
| JK | **Hoán Ảnh** | Mới, thay Bối Ảnh Bộ: **đổi chỗ** với phân thân gần tâm ngắm nhất; không có phân thân thì dịch chuyển ra sau lưng như cũ |
| KL | **Phân Ảnh Mồi** | Mới, thay Hóa Ảnh: Kage tàng hình 1 s, đồng thời thả 2 phân thân chạy theo 2 hướng chéo trước mặt (sống 5 s, trúng 1 đòn là tan). Phân thân tan thì nổ bóng làm chậm |
| JKL | Vạn Ảnh Táng: lướt chém 5 nhát | Giữ. Thêm (tuỳ chọn): **Màn Đêm**, màn hình đối thủ trong 15 m tối sầm 3 s, chỉ thấy rõ trong 6 m quanh mình |
| JJJ | Bối Ảnh Thích · Cực | Giữ |

- **Nội tại:** mọi đòn sau lưng ×1.5 (đã có).
- **Cách đối phó:** phân thân không gây sát thương và trúng 1 đòn là tan, nên chiêu lan rộng sẽ lộ ra con thật. Màn Đêm vẫn hiện tên người chơi gần.
- **Kỹ thuật:**
  - Phân thân mồi 🟡: server tạo thực thể "ma" có id riêng, gửi trong snapshot như người chơi (cờ `decoy` chỉ gửi cho Kage và đồng đội). Đường chạy là đường thẳng tất định, client tự nội suy. Chiêu tự khoá ở client đối thủ đã coi nó là người chơi.
  - Màn Đêm 🟢: hiệu ứng hậu kỳ phía client (vignette đen bán kính nhỏ), server chỉ gửi gói `dark`. Có thể gây khó chịu, nên để tuỳ chọn và kiểm tra trên điện thoại.

---

## 4. Tổng hợp khối lượng

| Nhân vật | Cơ chế chính | Độ khó | Phần nặng nhất |
|---|---|---|---|
| Kaze | Bay tự do, lướt 3D | 🟢 | Lướt 3D đồng bộ hướng y |
| Shiden | Cọc sét, hàng rào | 🟢 | Kiểm tra cắt hàng rào mỗi tick |
| Gantetsu | Cột đá, địa chấn | 🟢🟡 | Nhổ cột ném |
| Homura | Đất cháy, boomerang, hồi sinh | 🟢 | Vẽ vệt lửa nhẹ ở `low` |
| Kage | Phân thân mồi, màn đêm | 🟡 | Thực thể giả trong snapshot |
| Yuki | Sàn băng, tường vỡ, vùng chậm | 🟡 | Vật lý trơn ở client |
| Raiga | Giữ phím tụ khí, túm ném | 🟡🔴 | Túm ném (có phương án nhẹ) |
| Midori | Cây bắn gai, người cây | 🟡🔴 | AI người cây (có phương án nhẹ) |

**Đề xuất thứ tự:** đợt 1 Kaze, Shiden, Gantetsu → chơi thử → đợt 2 Homura, Kage → đợt 3 Yuki, Raiga, Midori.

**Gói tin mới dự kiến:** `ice` (vùng băng), `dynhp` (máu chướng ngại vật), `grab` (túm), `dark` (màn đêm), `fire` (vệt lửa, hoặc gộp vào gói vùng chung `zone`), `decoy` trong snapshot. `cast` có thể kèm `hold`.

## 5. Câu hỏi cần chốt

1. **Phạm vi:** chỉ đổi bộ chiêu dị biến, hay làm lại cả chiêu thường cho khác biệt hơn?
Hiện tại chỉ cần đổi chiêu dị biến, các chiêu thường có thể sẽ cân nhắc sau.
2. **Hồi sinh của Homura**: giữ, hay đổi thành "dưới 20% máu thì bất tử 1.5 s"?
Giữ
3. **Màn Đêm của Kage**: giữ hay bỏ? Có thể gây khó chịu, nhất là trên điện thoại.
Giữ, nhưng có thể tham phương án tạo làn sương mù sung quanh. Đặc biệt là chỉ thấy nhân vật khác và tên nhân vật trong phạm vi 6m, ngoài 6m thì không thấy.
4. **Raiga JK và Midori JKL**: làm bản đầy đủ (🔴), hay bản nhẹ trước rồi nâng cấp sau?
Làm bản đầy đủ
5. **Kaze bay tự do**: giới hạn độ cao bao nhiêu? Có nên nhận thêm sát thương khi đang bay không?
Nên giới hạn độ cao, và có thể nhận thêm sát thương khi đang bay.
6. **Sàn băng của Yuki**: chấp nhận hiệu ứng trơn chạy ở client (người gian lận bỏ qua được), hay cần server kiểm tra?
Chấp nhận để server đỡ bước kiểm tra.
7. **Thứ tự** làm như mục 4 có ổn không?
Ổn, nhưng mình thêm một file phần hiển thị version để từ nay khi có mỗi bản cập nhật sẽ có một version tương ứng, điều này cũng thuận tiện cho việc tracebility.

Note: Hiện tại không cần ưu tiên nhẹ để cho game có được trải nghiệm kịch tính và sinh động nhất nhưng vẫn có thể chạy được trên nền web điện thoại (hầu hết điện thoại hiện này đều có cấu hình mạnh).
