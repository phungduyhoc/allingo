/**
 * Danh sách mật khẩu lộ/phổ biến OFFLINE (S12 – pentest-1 việc mở; mạng ngoài bị chặn nên không tải bộ HIBP đầy đủ).
 * Nguồn: tổng hợp thủ công các mật khẩu xuất hiện nhiều nhất trong các bộ rò rỉ công khai (top-N quốc tế) + mẫu phổ biến tại
 * Việt Nam (tên/cụm từ không dấu + số). So khớp không phân biệt hoa thường sau khi bỏ khoảng trắng hai đầu.
 * Bổ sung: `BASE_WORDS` + hậu tố số/ký hiệu (vd "Password123!", "Matkhau@2026") được coi là yếu – xem password-policy.ts.
 * Muốn danh sách lớn hơn: đặt PASSWORD_HIBP_ENABLED=true (k-anonymity, chỉ gửi 5 ký tự đầu SHA-1).
 */
export const COMMON_PASSWORDS: readonly string[] = [
  '123456', '123456789', '12345678', 'password', 'qwerty123', 'qwerty1', '111111', '12345', 'secret', '123123', '1234567890',
  '1234567', '000000', 'qwerty', 'abc123', 'password1', 'iloveyou', '11111111', 'dragon', 'monkey', '123321', '654321',
  'qwertyuiop', '123qwe', '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', 'zaq12wsx', 'qazwsx', 'qazwsxedc', '1qaz2wsx', '1qaz2wsx3edc',
  'asdfghjkl', 'zxcvbnm', 'zxcvbnm123', 'asdf1234', 'qwer1234', 'qwerty12345', 'qwertyuiop123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'p@$$w0rd', 'password12', 'password123', 'password1234', 'password12345', 'password123456', 'password!', 'password1!', 'password123!',
  'password@123', 'passwordpassword', 'letmein', 'letmein123', 'welcome', 'welcome1', 'welcome123', 'welcome@123', 'welcome2024',
  'welcome2025', 'welcome2026', 'admin', 'admin123', 'admin1234', 'admin12345', 'admin@123', 'administrator', 'root', 'toor',
  'master', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'batman', 'trustno1', 'starwars', 'shadow', 'michael',
  'jennifer', 'charlie', 'jordan23', 'liverpool', 'chelsea', 'arsenal', 'manchester', 'computer', 'internet', 'whatever',
  'freedom', 'hello123', 'helloworld', 'hello@123', 'loveyou', 'iloveyou1', 'iloveyou123', 'iloveyou2', 'lovelove', 'loveme',
  'babygirl', 'princess1', 'flower', 'hunter2', 'killer', 'pokemon', 'naruto', 'minecraft', 'fortnite', 'samsung', 'iphone',
  'google', 'facebook', 'youtube', 'abcdef', 'abcd1234', 'abcdefg', 'abcdefgh', 'abc12345', 'abc123456', 'a123456', 'a1234567',
  'a12345678', 'aa123456', 'aa12345678', 'aaaaaa', 'aaaaaaaa', 'qqqqqq', '112233', '121212', '123654', '131313', '147258369',
  '159753', '159357', '192837465', '987654321', '9876543210', '0987654321', '1111111111', '0000000000', '00000000', '88888888',
  '99999999', '12341234', '1234512345', '123456123456', '123456654321', '12345678910', '123456789a', '123456789q', '1234567890a',
  '123456789abc', '0123456789', '147258', '741852963', '789456123', '789456', '456789', '123456a', '123456q', '123456abc',
  'q1w2e3r4', 'q1w2e3r4t5', 'q1w2e3r4t5y6', '1a2b3c4d', 'changeme', 'changeme123', 'default', 'guest', 'test', 'test123',
  'test1234', 'testing', 'testtest', 'demo', 'demo123', 'user', 'user123', 'login', 'login123', 'access', 'access14', 'mustang',
  'ninja', 'pepper', 'cheese', 'summer', 'winter', 'spring', 'autumn', 'summer2024', 'summer2025', 'winter2025', 'spring2026',
  'qwerty2024', 'qwerty2025', 'qwerty2026', 'password2024', 'password2025', 'password2026', 'p@ssword123', 'p@ssw0rd123',
  'zaq1zaq1', 'zaq1@wsx', '!qaz2wsx', '!@#$%^&*', '!@#$%^', '1q2w3e', 'asdasd', 'asdasdasd', 'asd123', 'qweqwe', 'qweasd',
  'qweasdzxc', 'qwe123', 'qwe123456', 'mypassword', 'mypassword1', 'mypass', 'yourpassword', 'nopassword', 'secret123',
  'secret1234', 'supersecret', 'iloveu', 'teamo', 'te amo',
  // Phổ biến tại Việt Nam (không dấu)
  'matkhau', 'matkhau123', 'matkhau1234', 'matkhau@123', 'matkhaumoi', 'anhyeuem', 'anhyeuem123', 'anhyeuemnhieu', 'emyeuanh',
  'emyeuanh123', 'yeuem', 'yeuanh', 'yeuemnhieu', 'yeuanhnhieu', 'iloveyouvn', 'vietnam', 'vietnam123', 'vietnam1234',
  'vietnam2024', 'vietnam2025', 'vietnam2026', 'vietnamvodich', 'hanoi', 'hanoi123', 'saigon', 'saigon123', 'hochiminh',
  'danang', 'nguyen', 'nguyen123', 'nguyenvan', 'tran123', 'le123456', 'pham123', 'hoang123', 'huynh123', 'phan123', 'vu123456',
  'dang123', 'bui123456', 'do123456', 'ngoc123', 'linh123', 'trang123', 'huong123', 'thanh123', 'tuan123', 'hung123', 'minh123',
  'duc123', 'nam123', 'long123', 'quang123', 'thao123', 'mai123', 'lan123', 'hoa123', 'cuong123', 'dung123', 'hai123',
  'conmeo', 'concho', 'conheo', 'meomeo', 'gaugau', 'khongbiet', 'khongcomatkhau', 'matkhaucuatoi', 'toilaai', 'xinchao',
  'xinchao123', 'camon', 'tieng anh', 'tienganh', 'tienganh123', 'hoctienganh', 'toeic', 'toeic123', 'toeic900', 'toeic990',
  'ielts', 'ielts123', 'ielts8.0', 'luyenthi', 'luyenthi123', 'hocsinh', 'sinhvien', 'sinhvien123', 'giaovien', 'thaygiao',
  'cogiao', 'bame', 'giadinh', 'hanhphuc', 'thanhcong', 'maimai', 'mai mai ben nhau',
  // Chuỗi dài ≥ 12 ký tự hay gặp (bộ HIBP top)
  'qwertyuiopasdfghjkl', 'iloveyouiloveyou', 'abcdefghijkl', 'abcdefghijklmnop', 'abcdefghijklmnopqrstuvwxyz', '123456789012',
  '1234567890123', '12345678901234', '123456789123', '123456789987654321', '111111111111', '000000000000', '123123123123',
  '112233445566', '147852369874', 'qwertyqwerty', 'asdfasdfasdf', 'aaaaaaaaaaaa', 'passwordpassword1', 'iloveyou12345',
  'administrator1', 'administrator123', 'welcometo2026', 'letmein12345', 'trustno1trustno1', 'football1234', 'baseball1234',
  'superman1234', 'princess1234', 'sunshine1234', 'qwerty123456', 'qwerty1234567', 'qwertyuiop12', 'zxcvbnm123456',
  '1q2w3e4r5t6y7u', '1qaz2wsx3edc4rfv', 'zaq12wsxcde3', 'q1w2e3r4t5y6u7', 'anhyeuem123456', 'emyeuanh123456', 'matkhau123456',
  'vietnam123456', 'nguyen123456', 'hello1234567', 'helloworld123', 'changeme1234', 'password1234!', 'password12345!',
];

/**
 * Từ gốc yếu: "<từ gốc><hậu tố số/ký hiệu ≤ 6>" (sau khi bỏ hậu tố) bị coi là mật khẩu lộ dạng biến thể
 * (vd Password123!, Matkhau@2026, Qwerty!2026). Không chứa tên sản phẩm để không chặn mật khẩu demo đã cấp.
 */
export const BASE_WORDS: readonly string[] = [
  'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbnm', 'iloveyou', 'welcome',
  'admin', 'administrator', 'letmein', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'batman',
  'master', 'hello', 'helloworld', 'abc', 'abcdef', 'abcdefgh', 'changeme', 'secret', 'test', 'testing', 'login', 'user', 'guest',
  'matkhau', 'anhyeuem', 'emyeuanh', 'yeuem', 'yeuanh', 'vietnam', 'hanoi', 'saigon', 'xinchao', 'toeic', 'ielts', 'tienganh',
  'sinhvien', 'hocsinh',
];
