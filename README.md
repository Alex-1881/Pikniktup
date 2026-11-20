# Pikniktüp v1.6 — PEAK / YouTube-klip odaklı sade arayüz

## Neler değişti?

- Ana sayfa sade: Büyük tanıtım/keşif kutuları, çift kategori sırası, gereksiz pazarlama yazıları ve 4 tanıtım videosu ana akıştan çıkarıldı. Girişte gerçek YouTube video kartları ve tek kategori çubuğu görünür.
- **Resmî klipler**: YouTube Data API araması müzik videosu odaklıdır; başlığında "official audio", "lyrics", "Topic", "visualizer" vb. olanları filtrelemeye çalışır. **Bu bir garanti değildir**: YouTube API'si videonun gerçekten klip olduğunu otomatik doğrulayamaz.
- **Canlı müzik**: Canlı performans/konser araması; **Tüm şarkılar**: kapak görselli YouTube Music kayıtları da dahil olmak üzere müzik kategorisi.
- YouTube trend, komedi, dizi/film, oyun, eğlence, teknoloji, spor, eğitim, yaşam aramaları ve video kartları.
- YouTube Shorts keşfi eklenmiştir; Pikniktüp'e yüklenen Shorts videoları alt bölümde korunmuştur.
- Yerel Pikniktüp yüklemeleri ana sayfada ancak **gerçek kullanıcı videosu varsa** ayrı bölüm olarak görünür. Demo videoları artık ana akışı doldurmaz.
- 60 tema, Pikniktüp yerel video yükleme, izleme, hesap, kullanıcı profili, OWNER, geçmiş, kaydedilenler ve arama korunmuştur.
- YouTube içeriği YouTube'un resmî gömülü oynatıcısında açılır; YouTube uygulamasının kendisi değildir. Telif/reklam politikaları ve gömme kısıtlamaları geçerlidir.

## Yayınlama: Yanlış sürüm sorunu yaşamamak için

1. ZIP'i aç. GitHub `Alex-1881/piknik_tube` deposunun **kök dizinine** ZIP'in içeriğini yükle; özellikle `index.html`, `version.txt`, `api/youtube.js`, `api/status.js` ve `vercel.json` dosyalarını güncelle.
2. GitHub'da Commit changes yap. Vercel'de yeni commit'e bağlı Ready deployment'ı aç; gerekiyorsa **Promote to Production** seç. Eski deployment'a Redeploy basmak eski sürümü geri getirebilir.
3. `https://pikniktube-two.vercel.app/version.txt` adresi `PIKNIKTUP_VERSION=1.6` göstermeli. `https://pikniktube-two.vercel.app/api/status` adresinde `version: 1.6`, `youtubeApiConfigured: true` olmalı.
4. Vercel → Environment Variables altında `YOUTUBE_API_KEY` bulunmalı. YouTube Data API v3 Google Cloud'da etkin olmalı. Anahtarı koduna ya da GitHub'a koyma.
5. Müzik klipleri için `/api/youtube?category=Klipler`, Shorts için `/api/youtube?category=Shorts` JSON liste dönmelidir.

**SQL dosyaları bu pakette yok.** YouTube akışı Supabase'den bağımsızdır; Pikniktüp kullanıcı yüklemeleri için mevcut Supabase tabloları yine gereklidir. SQL dosyasını GitHub'dan silmek Supabase tablolarını silmez.

**Test sınırı:** Resmî YouTube API ve kullanıcıya ait canlı Supabase hesap anahtarıyla doğrudan test yapılmadı. Tarayıcı etkileşimleri ve sahte YouTube API yanıtlarıyla kontrol edilmiştir. Aramalarda API kota maliyeti ve bölgesel erişim etkili olabilir.
