# Pikniktüp v1.7.2 — Daha sağlam arama

Pikniktüp v1.6'nın görünümünü ve özelliklerini koruyan yükseltme. **Arama Invidious üzerinden yapılır**, ana sayfa popüler videoları ve ayrıntılar için ise (yapılandırılmışsa) resmî **YouTube Data API v3** kullanılır. Video oynatma yine resmî YouTube gömme oynatıcısıyladır.

## En hızlı kurulum

1. ZIP'i aç. İçindeki **dosyaların tamamını** GitHub'daki mevcut `piknik_tube` deposunun ana dizinine yükle. Üstüne yazmak istediğinde onayla. Mevcut depoyu silmene gerek yok.
2. Vercel'de projenin **Settings → Environment Variables** bölümünü aç. Eskiden kullandığın `YOUTUBE_API_KEY`, `SUPABASE_URL` ve `SUPABASE_ANON_KEY` değişkenlerini aynı şekilde bırak. **Anahtarları `index.html` içine yazma.**
3. **INVIDIOUS_INSTANCES isteğe bağlıdır.** Ayarlamazsan bu sürüm, Invidious'un resmî olarak listelenen dört genel HTTPS sunucusunu dener. Kendi erişilebilir sunucun varsa örneğin `https://senin-invidious-sunucun.example` biçiminde; birden çoksa virgülle ayırarak bu değişkene yazabilirsin. Sadece kök adresleri kullan; `/api/v1` ekleme.
4. Vercel'de **Deployments → Redeploy** yap (veya GitHub'a yeni commit göndererek otomatik dağıtım yapılmasını bekle).
5. `https://SITEN.vercel.app/api/youtube?health=1` sayfasında `version: 1.7.2` gör. Ardından normal sitede `lvbel c5` arayıp **Enter** veya arama simgesine bas.

## Neler düzeltildi?

- Arama, her karakterde çalışmaz; kullanıcı Enter'a bastığında ya da arama simgesine tıkladığında başlar.
- `search.list` çağrılarını varsayılan yolda kullanmaz; YouTube'un **günlük arama kotasını tüketmez**.
- Sunucu sonuçları, hem CDN hem de kısa süreli bellekte önbelleklenir. Aynı anda gelen aynı sorgu istekleri birleştirilir.
- Bozuk Invidious sunucusuna aynı anda çok fazla istek göndermez; iki sunucu sınırından sonra anlaşılır hata ve bekleme süresi bildirir.
- Resmî YouTube Data API anahtarı verilmişse popüler videolar ve video ayrıntıları eskisi gibi çalışır; verilmemişse bunlarda da Invidious'a geçebilir.
- Kullanıcının `id`, `search`, `pageToken` parametreleri doğrulanır; anahtarlar frontend'e sızdırılmaz; video ID ve resim URL'leri güvenli biçimde oluşturulur.
- Arama sonucu dönmese bile arayüz, mevcut Pikniktüp içeriğini ve kategorileri korur.

## Önemli gerçekler

**Bu paket canlıda çalışacağı garantili, ücretli bir video arama servisi sağlamaz.** Genel Invidious sunucuları zaman zaman yanıt vermeyebilir, kullanıcı veya sunucu bazlı istek sınırı koyabilir ya da YouTube değişiklikleri nedeniyle aramayı kaybedebilir. Daha güvenilir üretim sistemi için kendi yönetilen bir Invidious sunucusu veya kota tahsisi yapılmış resmî API gerekir. Paket, belgelenmiş API sözleşmelerine göre geliştirildi ve testler ağ yerine taklit edilmiş yanıtlarla çalıştırıldı; gerçek Vercel dağıtımında test edilmesi gerekir.

Arama sonuçlarındaki oynatılabilirlik, resmî YouTube embed izinlerine bağlıdır. Invidious arama yanıtları oynatılabilirlik bayrağı sağlamadığı için bazı videolar sonradan YouTube tarafından engellenebilir. Klipler sekmesindeki kapak görseli filtrelemesi yalnızca başlık/kanal üzerinden tahmin yürütür.

**Test:** Node.js 20+ varsa `node --test tests/youtube.test.js` komutunu çalıştırabilirsin (10 test).

**Teşhis:** `/api/youtube?health=1`, `/api/status`, Vercel → Logs. `X-Pikniktup-Cache` başlığı `MISS`, `HIT` veya `STALE` olabilir. Kesintilerde kullanıcıya şifre/anahtar istemeden hata kodu verilir.

Kaynaklar: https://docs.invidious.io/api/ ve https://docs.invidious.io/instances/ . Bu sürüm üçüncü taraf servislerle resmî YouTube ortaklığı iddiasında bulunmaz.


## 1.7.2 arama kurtarma (önemli)

- `api/youtube.js` artık Invidious başarısız olduğunda **resmî YouTube Data API v3 aramasını** yedek olarak deneyebilir.
- Google Search API günlük kotanız hâlâ doluysa arama **hemen çalışmayacaktır**. Yeni API anahtarı aynı projenin kotasını yenilemez.
- Yedek API araması kullanıcı aramaları için `search.list` kullanır; Google API kotası tüketir.
- Vercel `YOUTUBE_API_KEY` mevcutsa kullanılır; istemciye gönderilmez.
- Bot kontrolü uygulayan veya API erişimini kapatan Invidious sunucuları için sorunsuz sonuç vaat edilmez.
- İlk arama testi için `?category=Kar%C4%B1%C5%9F%C4%B1k&search=lvbel%20c5` kullanın.
- Tarayıcıda arama sadece Enter ile gönderilir; eski dosyaları tümüyle değiştirmeden kurulum için yalnızca API ZIP'ini yükleyin.
