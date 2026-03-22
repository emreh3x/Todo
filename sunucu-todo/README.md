# Sunucu Kurulumu

Bu klasor, uygulamayi kendi sunucunda domain altinda yayinlamak icin hazirlanmis minimal pakettir.

## 1. Ortam dosyasi

```bash
cp .env.example .env
```

`.env` icinde sunlari doldur:

- `APP_SECRET_KEY`
- `SERVER_NAME`
- `ALLOWED_ORIGINS`
- `APP_HTTP_PORT`
- `APP_HTTPS_PORT`

## 2. SSL sertifikasi

Sertifika dosyalarini bu klasore koy:

- `deploy/certs/fullchain.pem`
- `deploy/certs/privkey.pem`

## 3. Ilk kullaniciyi olustur

```bash
python scripts/create_user.py --username admin --password 'guclu-bir-sifre' --admin
```

## 4. Yayina al

```bash
docker compose up -d --build
```

Varsayilan portlar:

- HTTP: `8088`
- HTTPS: `8448`

## 5. Giris

Uygulama acildiktan sonra olusturdugun kullanici ile secilen port uzerinden giris yapabilirsin.

Ornek:

- `http://sunucu-ip:8088`
- `https://sunucu-ip:8448`

Eger domaine mevcut bir reverse proxy ile baglayacaksan, onu bu portlara yonlendirebilirsin.

Sadece HTTP ile test edeceksen `.env` icinde su ayari da yap:

```env
SESSION_COOKIE_SECURE=false
```

Origin hatasi yasamamak icin domain ve local test adresini de `.env` icine ekle:

```env
ALLOWED_ORIGINS=https://agalar-todo.guardchatrie.com,http://192.168.1.145:8088
```

Yerel agda hizli test icin sertifika istemeyen HTTP-only mod:

```bash
docker compose -f docker-compose.http.yml up -d --build
```

Bu mod sadece `APP_HTTP_PORT` uzerinden yayin yapar ve SSL sertifikasi istemez.

## Notlar

- `data/` klasoru otomatik olusur ve kalici kullanici verilerini tutar.
- Bu paket kullanici verisini veya eski local `storage.txt` / `link.txt` dosyalarini icermez.
- Eger legacy veriyi de tasimak istersen o iki dosyayi bu klasore elle ekleyip kullanici olustururken `--migrate-legacy` kullanabilirsin.
