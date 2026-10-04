# One-shot vision: kablosuz ortamı ilk bakışta anlamak

Bu belge, ilk Astra planı ile [Opus planının](one-shot-vision-opus.md) değerlendirilmesi sonucunda oluşan birleşik tasarım ve uygulama planıdır. Öncelik, binadaki kablosuz gözlemleri açıklama gerektirmeden okumaktır. Opus'un özgün belgesi karşılaştırma için korunur. Aşağıdaki kabul maddeleri doğrulama ölçütleridir; insanlarla beş saniye testi yapıldığı anlamına gelmez.

## 1. Ürün kararı

**Açılış ekranının konusu görülen kablosuz cihazlar olmalı.** Pi'ler veriyi toplayan sensörlerdir; kurulum yapılırken veya gözlemi etkileyen bir sorun olduğunda öne çıkar.

İlk ekran dört soruya cevap verir:

1. Kaç farklı Wi-Fi erişim noktası ve Bluetooth adresi gözleniyor?
2. Hangi katlardaki sensörler bunları görüyor?
3. Gözlemler güncel ve eksiksiz mi?
4. Yeni bir kayıt veya dikkat gerektiren bir gözlem sorunu var mı?

Okuma sırası **durum cümlesi → sabit anlamlı sayılar → cihaz listesi ve kısa kat özeti → seçilen cihazın kaynakları → teknik analiz** olur. Genel bakışta büyük Pi kartları, boş bir ayrıntı paneli veya sürekli açık grafikler yer kaplamaz.

Hedef masaüstüdür. 1366×650 kullanılabilir tarayıcı alanı temel yükseklik bütçesidir; 1440×900 ve 1920×1080'de de aynı hiyerarşi korunur. Dar pencerede bölümler alt alta geçer. Oda/bölge modeli veya ayrı bir mobil ürün akışı eklenmez.

## 2. İki plandan alınan kararlar

| Fikir | Karar ve gerekçe |
| --- | --- |
| Opus: üst gezinmede Genel bakış / Cihazlar / Sensörler / Analiz | **Alındı.** İzleme, tam liste, kurulum ve teknik inceleme açıkça ayrılır; kalıcı Pi yan menüsü kaldırılır. |
| Opus: anlamı değişmeyen sayaçlar, kısa durum cümlesi, kompakt kat çubukları | **Alındı.** Bina genelindeki Wi-Fi/Bluetooth ve “Yeni · son 10 dk” sayıları filtrelerden bağımsızdır. Gözlem güvenilirliği küçük bir göstergedir. |
| Astra: radyo ailesi + MAC ile birleştirme; kaynak Pi okumalarını koruma | **Alındı.** Aynı adres tek satır olur; BT/BLE sınıflandırması adresi çoğaltmaz. |
| Opus: en güçlü RSSI'ye göre cihazı tek kata yerleştirme | **Uyarlandı.** “Gözlenen katlar” gösterilir. Aynı kayıt birden fazla katta görülebilir; RSSI kesin fiziksel konum sağlamaz. |
| Opus: “cihaz sayısı”, Wi-Fi ağları ve Bluetooth türleri | **Uyarlandı.** Sayım adres bazındadır. Wi-Fi bağlı istemci sayısı değildir; ad/SSID aynı diye kayıtlar birleştirilmez. Tür yalnız bildirilen bilgi destekliyorsa gösterilir. |
| Astra: seçili kata göre değişen üst sayaçlar | **Uyarlandı.** Üst sayaçlar bina genelinde sabit kalır. Kat/arama/durum filtreleri yalnız listeyi daraltır ve liste kapsamı ayrıca yazılır. |
| Opus: tarayıcıda geçici “yeni” bilgisi ve daha sonra sunucuya geçiş | **Doğrudan ortak sunucu temeli seçildi.** Sayfa yenilemesi yeni cihaz dalgası yaratmaz; tazelik ve sınırlı geçmiş tüm ekranlarda aynı kaynaktan gelir. |
| İki plan: ortak kat ataması ve daha gerçekçi demo | **Alındı.** Atamalar sunucuda saklanır; örtüşen adresler, geliş/kayıp ve değişen sinyal senaryoları eklenir. |
| Üretici tahmin tablosu, tek RSSI'den alarm/sağlık puanı, yeni `/api/devices` servisi | **Bu teslimata alınmadı.** İlk bakış görevine gerekli değildir. Mevcut API ve küçük saf dönüşümler yeterlidir; desteklenmeyen yorum yapılmaz. |
| Kalıcı cihaz geçmişi, bildirim sistemi, cihazlara özel isim, oda takibi | **Sonraki ihtiyaç değerlendirmesine bırakıldı.** Bu çalışma ekran hiyerarşisi ve güvenilir kısa dönem gözlem durumunu tamamlar. |

## 3. Sayılar neyi anlatır?

| Ekrandaki bilgi | Anlamı |
| --- | --- |
| Wi-Fi erişim noktası | Görülen farklı BSSID adresleri. Aynı SSID'yi kullanan iki BSSID iki kayıttır. Bağlı telefon/bilgisayar sayısını söylemez. |
| Bluetooth cihazı | Radyo ailesi içinde farklı yayın adresleri. BT ve BLE aynı MAC'i bildirirse bir kayıt sayılır. Adres değiştiren fiziksel cihazlar ayrı kayıt oluşturabilir. |
| Gözlenen katlar | Kaydı duyan sensörlerin atandığı katlar. Cihazın kesin bulunduğu kat, kişi konumu veya hareket rotası değildir. |
| Sinyal | Seçilen sensörün aldığı RSSI. dBm; uzaklık, hız, paket kaybı veya ölçülmüş bağlantı kalitesi yüzdesi değildir. |
| Yeni görülen | Başlangıç gözlemlerinden sonra ilk defa görülen adres; son 10 dakikalık pencere. |
| Artık görülmüyor | Çalışan kaynakların yeterli sayıda başarılı taramasında yok. Cihazın kapandığı veya binadan çıktığı sonucu çıkarılmaz. |

Wi-Fi ve Bluetooth için ayrı sayaç kullanılır. Kişi veya kesin fiziksel cihaz toplamı üretilmez. Katlarda örtüşen adresler olabildiğinden **kat sayıları toplanarak bina toplamı bulunmaz**. Bu açıklama kat özetinde görünür kalır.

## 4. Dört görünüm

### Genel bakış

Üst çubukta dört görünüm ve küçük bağlantı/tema kontrolleri bulunur. İçerik sırası:

- Tek bir öncelikli durum cümlesi: örneğin “2. katın Wi-Fi gözlemi eksik; sayılar kısmi olabilir.” Normal durumda sakin bir güncellik ifadesi.
- Bina genelinde **Wi-Fi**, **Bluetooth**, **Yeni · son 10 dk** sayaçları ve küçük gözlem güncelliği göstergesi. Liste filtresi bu sayıların anlamını değiştirmez.
- En geniş alanda tekilleştirilmiş cihaz listesi; yanında üç katın kısa özeti.
- Dummy sensör varsa görünür **Demo**, gerçek ve dummy birlikteyse **Karma veri** açıklaması.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Device Scanner  [Genel bakış] Cihazlar Sensörler Analiz       Bağlantı   ◐ │
├──────────────────────────────────────────────────────────────────────────┤
│ Gözlemler güncel. / 2. katın Wi-Fi gözlemi eksik.             [İncele]   │
│ Wi-Fi erişim noktası     Bluetooth cihazı     Yeni · 10 dk   Güncellik   │
├────────────────────────┬─────────────────────────────────────────────────┤
│ Katlarda gözlenenler   │ Görülen cihazlar        [Tüm cihazlar →]         │
│ 3. kat · Wi-Fi / BT    │ [Ara] [Tür] [Kat] [Durum]                        │
│ 2. kat · Kısmi gözlem  │ Ad · tür · gözlenen katlar · durum · son görülme │
│ 1. kat · Wi-Fi / BT    │ İlk beş kayıt kaydırmadan görünür                │
│ Kat sayıları örtüşür.  │ …                                               │
└────────────────────────┴─────────────────────────────────────────────────┘
```

Bir kata veya metriğe tıklamak ilgili liste filtresini uygular. Pi kimlikleri genel bakışın ana görseli olmaz; sorun açıklamasında veya cihaz ayrıntısında gerektiği kadar gösterilir.

### Cihazlar

Aynı adres modeli üzerinden tam liste, ad/adres araması, radyo, kat ve durum filtreleri sunulur. Varsayılan tür **Tümü** olur. Kayıt adı yoksa “Gizli ağ” veya “Adsız cihaz” gibi açık bir ifade kullanılır; adres ayrıntıda kimliği ayırt eder.

İlk 50 satır gösterilir; daha fazlası açık bir kontrolle yüklenir. Yeni taramalar mevcut satırları RSSI değiştikçe yerinden oynatmaz. Filtre veya sıralama tercihi değişince sıra hesaplanır; kullanıcı ayrıca yeniden sıralayabilir. Seçim, odak ve kaydırma korunur.

Bir kayda tıklamak sağdan ayrıntı panelini açar:

1. Adı, türü, gözlem durumu, sunucu oturumundaki ilk/son görülmesi ve gözlenen katlar.
2. **Gözlem kaynakları:** Pi, kat, kaynak durumu, kendi RSSI'si ve son görülmesi.
3. Seçilen kaynağın sinyal geçmişi; kaynak seçimiyle grafik etiketi birlikte değişir.
4. Kapalı başlayan özgün WiGLE kaydı ve seçili kaynağı Analiz'de açma eylemi.

Farklı Pi'lerin RSSI okumaları tek bir çizgiye eklenmez. Panel Escape veya kapatma düğmesiyle kapanır; klavye odağı geldiği kontrole döner.

### Sensörler

Büyük üç katlı bina, Pi kartları, bir kata birden fazla Pi atama ve “Bulunduğu kat” kontrolü burada kalır. Sensör tablosu bağlantı durumunu, her radyonun son başarılı taramasını ve hata metnini ayrı gösterir.

`pi-01`/`pi-1`, `pi-02`/`pi-2`, `pi-03`/`pi-3` sırasıyla 1., 2., 3. kata varsayılan yerleşir. Diğer kimlikler atanmamış başlar. Açık bir atama veya `null` seçimi bu varsayılanı geçersiz kılar. Atanmamış sensörün verisi bina genelinde kaybolmaz.

Atamalar bütün kullanıcılar için sunucudadır: `GET/POST /api/placements`. Dosya varsayılan olarak `.device-scanner/placements.json`; `server` ve `dev` komutlarında `--placements-file PATH` ile değişir. Başarısız kayıt önceki atamayı korur ve hata gösterir. Kat bilgisi WiGLE alanlarına yazılmaz.

### Analiz

Pi/radyo başına özgün gözlem tablosu, Wi-Fi bant filtresi, sıralama, kanal/sinyal dağılımı, kaynak sinyal geçmişi ve JSON/CSV dışa aktarma korunur. Buradaki satır sayısı, cihaz listesindeki tekil adres sayısından farklı olabilir.

CSV her kaynak Pi'nin özgün WiGLE v1.6 kaydını ve 14 sütununu korur. Birleştirilmiş bir ortalama RSSI veya sahte konum kaydı üretilmez. JSON kaynak, filtre, zaman ve eski veri metaverisini de taşır. Sinyal grafiği bu tarayıcı oturumundaki son 60 kaynak ölçümüdür; kalıcı tarihçe değildir. Kanal grafiği erişim noktası sayar, parazit veya kanal doluluğu ölçmez.

## 5. Tazelik, yeni kayıt ve görülmeme kuralları

Bu durumlar sayfa açılış saatine veya sadece heartbeat'e dayanmaz. Node, rapor zarfında etkin radyoları ve beklenen çevrimi bildirir. Beklenen çevrim tarama penceresi ile bekleme aralığının toplamıdır. Eski node'larda metaveri eksikse radyo durumu bilinmiyor olarak başlar; gelen tarama o radyonun etkin olduğunu gösterir.

**Radyo tazeliği:** son başarılı taramanın sunucuya ulaşmasından itibaren `max(30 sn, 2 × beklenen çevrim)` sınırına kadar taze kabul edilir. Pi bağlantısı, sunucu bağlantısı ve radyo tazeliği ayrı değerlendirilir. Hata raporu `last_success_at` değerini veya başarılı gözlemlerin yaşını yenilemez. Kapalı radyo, hata ve henüz veri beklenmesi ayrı durumdur.

**Adres durumu:**

| Durum | Kural ve sayaç davranışı |
| --- | --- |
| Görüldü | En az bir çevrimiçi, taze ve başarılı kaynakta son taramada var. Güncel toplamda sayılır. |
| Az önce görüldü | Taze kaynakta son taramada yok, ancak son görülmesi en fazla 60 sn önce. Kısa BLE aralıklarında toplamı oynatmamak için sayılmaya devam eder. |
| Durum bilinmiyor | Kaynak gözlem veremiyor veya yokluk için yeterli süre/başarılı tarama oluşmadı. Güncel toplamı şişirmez. |
| Artık görülmüyor | İlgili kaynaklarda en az iki başarılı taramada yok ve son görülmeden sonra `max(60 sn, 3 × beklenen çevrim)` geçti. Bir kaynak hâlâ veri veremiyorsa kesin görülmeme yerine belirsizlik korunur. |

Hatalı taramalar yokluk sayacını artırmaz. Yeni, taze bir kaynak kaydı güncel durumu geri getirir. Taze ve boş ilk tarama **0** olabilir; geçmişte görülen kayıtlar varsa önce 60 saniyelik tolerans geçerlidir. Güncel gözlem kaynağı olmayan kat/radyo **—** gösterir. Kısmen çalışan katta görülen sayı, “kısmi” açıklamasıyla sunulur. Bilerek kapatılan radyo sensör arızası sayılmaz.

**Yeni görülen:** her Pi/radyo kaynağının ilk başarılı taraması başlangıç kümesidir. Sonraki taramalarda ilk kez görülen bina düzeyindeki adres 10 dakika yeni işaretlenir. Başka Pi aynı adresi duyunca ortak ilk görülme ve yeni bayrağı korunur. Yeni bir Pi'nin ilk raporundaki daha önce bilinmeyen adresler başlangıç kabul edilir. Sayfa yenilemesi ve yeni tarayıcı sekmesi bu kuralları sıfırlamaz.

**Saklama sınırları:** kaynak gözlemleri son görülmelerinden itibaren 15 dakika tutulur; bütün Pi/radyolar için toplam 10.000 kayıt sınırı vardır. Tekrar görülen adresleri tanımak için sunucu oturumu boyunca ayrıca en fazla 10.000 kimlik saklanır. Bu sınır aşılıp kimlik unutulursa gelecekteki ilk görülmesi yeniden değerlendirilebilir. Kalıcı cihaz envanteri veya sınırsız geçmiş iddiası yoktur.

Sunucu yeniden başladığında geçici geçmiş ve ilk tarama tabanı yeniden oluşur; `session_started_at` bu izleme dönemini tanımlar. Kat atamaları dosyada kaldığından korunur. Tarayıcı sunucuya erişemediğinde son alınan görünümü tutar, güncel sayı iddiasını kaldırır ve yeniden bağlanmayı dener.

## 6. Görsel ve etkileşim kuralları

- Arayüz Türkçe; ürün adı, protokol adları ve özgün WiGLE alanları korunur.
- Petrol yeşili vurgu, açık/koyu tema ve mevcut sade görsel dil sürer. Renk tek başına durum taşımaz; kısa metin ve simgeyle desteklenir.
- Ana ekranın güçlü eylemi bir kaydı incelemektir. Dışa aktarma ve yerleşim yönetimi ilgili görünümlerindedir.
- Ekran okuyucu durum türü değişimini duyar; iki saniyede bir değişen her sayı yeniden duyurulmaz.
- Arama, kat filtresi, tablo gezinmesi ve panel klavyeyle kullanılabilir. `/` aramaya, `1`–`3` katlara, Escape açık ayrıntıdan çıkmaya yardımcı olur.
- Teknik alanlar ihtiyaç anında açılır. Kaynak seçimi, düzey ve birimler gizlenerek daha kesin bir anlam üretilmez.

## 7. Demo ve kod yapısı

Her dummy Pi başlangıçta **8 Wi-Fi ve 12 Bluetooth** adresi duyar; bunların 3 Wi-Fi ve 5 Bluetooth adresi Pi'ler arasında ortaktır. Üç Pi'de başlangıç bina toplamı **18 Wi-Fi, 26 Bluetooth** olur. Aynı adresin RSSI'si kaynak başına değişir.

Yedinci taramada her radyoya yeni bir yerel adres gelir. Her 24 taramalık döngünün 12. ve 13. taramalarında bir yerel adres geçici olarak kaybolur, sonra geri gelir. Açık ağ, gizli SSID, farklı Wi-Fi bantları ve çeşitli Bluetooth türleri bulunur. RSSI'de sürüklenme, küçük gürültü ve ara sıra düşüş vardır. Bunlar gerçek bina veya GPS ölçümü değildir.

| Alan | Sorumluluk |
| --- | --- |
| `static/index.html`, `styles.css` | Dört görünüm, ilk ekran hiyerarşisi, kat özeti ve ayrıntı paneli. |
| `js/app.js`, `api.js` | Görünüm/filtre/odak durumu, anlık görüntü ve kat ataması istekleri. |
| `js/entities.js` | Adres bazında birleştirme, kat ilişkileri, güncellik ve özetlerin saf dönüşümleri. |
| `js/overview.js`, `devices.js` | Ortam özeti, tekil cihaz listesi ve kaynak ayrıntısı. |
| `js/building.js`, `nodes.js`, `placement.js` | Sensör görünümü ve paylaşılan kat ataması. |
| `js/observations.js`, `results.js`, `details.js`, `charts.js`, `export.js` | Kaynak bazlı teknik analiz ve özgün WiGLE dışa aktarma. |
| `server.py`, `monitoring.py`, `placements.py`, `node.py` | Tazelik metaverisi, sınırlı ortak geçmiş, atomik kat kaydı ve bağımsız radyo döngüleri. |
| `scanners/dummy.py` | Tekrarlanabilir geliş/kayıp senaryosu ve değişen ölçümler. |

HTML/CSS/JavaScript doğrudan Python sunucusundan sunulur. Yeni framework, derleme adımı veya ayrı servis gerekmez. İşlevler küçük modüllerde tutulur; cihaz birleştirme ile DOM çizimi ayrıdır. WiGLE'nin 14 alanı değişmez; uygulama metaverisi ayrı zarfta kalır.

## 8. Kabul ölçütleri ve doğrulama

Uygulama tamamlanırken aşağıdaki ölçütler kaynak kodu, API davranışı ve gerçek tarayıcıyla kontrol edilir. Otomatik sonuçlar uygulama tesliminde ayrıca raporlanır; bu belge tek başına testlerin geçtiğinin kanıtı değildir.

1. **İlk ekran:** 1366×650, 1440×900 ve 1920×1080'de %100 yakınlaştırmada durum mesajı, ortam sayaçları, üç kat özeti ve en az ilk beş cihaz satırı kaydırmadan görünür. Ana ekranda büyük Pi yerleşimi veya otomatik açılmış boş ayrıntı yoktur.
2. **Sayım:** aynı BSSID'yi üç Pi görürse bir cihaz ve üç kaynak vardır. Aynı adlı farklı adresler ayrıdır. BT/BLE aynı adresi iki kez saymaz. Farklı katlarda ortak adres bina toplamını çoğaltmaz.
3. **Anlam kararlılığı:** arama, tür veya kat filtresi üstteki bina toplamlarını değiştirmez. Liste kapsamı ve gösterilen kayıt sayısı ayrıca açıklanır.
4. **Güncellik:** heartbeat sürerken radyo eskir; hata son başarılı zamanı yenilemez; kapalı radyo sonsuz bekleme/arızayla karışmaz. Sensörsüz veya gözlemsiz kat sıfır göstermez. Kısmi kesinti açıkça etiketlenir.
5. **Geçmiş:** ilk tarama yeni dalgası oluşturmaz; yedinci dummy taramada yeni kayıt görünür; kısa kayıp toleransında sayı sabit kalır. Başarılı iki yokluk ve süre koşulu sağlanmadan “artık görülmüyor” denmez. Sayfa yenilemesi yeni bayrağını sıfırlamaz; sunucu yeniden başlaması yeni dönemdir.
6. **Yönetim:** bir katta birden çok Pi olabilir. Kat değişikliği diğer tarayıcıya yansır, yeniden başlatmada korunur; yazma hatasında eski atama kalır. Atanmamış Pi genel sayımda görünür.
7. **Analiz ve erişilebilirlik:** kaynak sinyal geçmişi birbirine karışmaz; WiGLE CSV başlığı 14 alanı ve özgün ölçümleri korur. Odak, seçim, kaydırma, koyu tema ve dar pencere kullanımı çalışır. En az 100–500 kayıtla satır kararlılığı denenir.

Doğrulama komutları:

```bash
python3 -m unittest discover -s tests -v
node --test tests/frontend/*.test.js
node tools/check_browser.mjs
```

**İnsanlarla beş saniye testi henüz yapılmadı.** Önerilen sonraki ürün kontrolü: beş kişiye ekranı beş saniye gösterip kapatmak; neyin sayıldığını, hangi katlarda gözlendiğini, gözlemin güncel olup olmadığını ve öne çıkan sorunu sormak. Hedef en az dört kişinin dört soruyu doğru açıklaması. Bu küçük test yön bulmak içindir; otomatik piksel/işlev kontrollerinin yerine geçmez.


## 9. Uygulama doğrulaması — 4 Ekim 2026

Birleşik düzen uygulandı. Pi yerleşimi Sensörler'e, kaynak grafikleri ve dışa aktarma Analiz'e taşındı. Genel bakışta sabit bina toplamları, kat özeti ve tekilleştirilmiş cihaz listesi; seçim yapıldığında kaynak ayrıntıları bulunuyor.

- `.venv/bin/python -m unittest discover -s tests -v`: **49 test geçti**; HTTP, bağımsız demo süreçleri, geçmiş, tazelik ve kalıcı kat ataması dahil.
- `npm test`: **27 test geçti**; kimlik birleştirme, gözlem durumları, kat örtüşmesi, arama, ölçüm geçmişi ve WiGLE dışa aktarma dahil.
- `node tools/check_browser.mjs`: **15 gerçek Chrome senaryosu geçti**. 1366×650, 1440×900 ve 1920×1080'de üç kat özeti ve ilk beş kayıt görünür. 119 kayıtla kademeli listeleme, odak/klavye, ortak katlar, kesinti/toparlanma ve demo→gerçek veri geçişi kontrol edildi.
- Yerel üç Pi demosunda görünüm ayrıca incelendi. Başlangıç 18 Wi-Fi / 26 Bluetooth; yeni kayıtların gelişinden sonra 21 / 29. Her iki radyo güncel, 1./2./3. kat varsayımları doğru.

Tarayıcı kesintisi grafikte boşluk oluşturur. Bir Pi'nin demo/gerçek modu değişirse eski modun ölçümleri ve tarayıcı sinyal örnekleri temizlenir. İnsanlarla beş saniyelik anlama testi henüz yapılmadı; yukarıdaki öneri sonraki ürün doğrulamasıdır.
