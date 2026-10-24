/**
 * Certificado autoassinado (CN=localhost, SAN localhost/127.0.0.1, validade de 100 anos)
 * usado só nos testes de HTTPS. Gerado com:
 * openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 36500 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1
 */
export const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBmjCCAUGgAwIBAgIUKK7ukvSeCiDxNlWdp/buigGxTVwwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAxOTExNTAyM1oYDzIxMjYwOTI1
MTE1MDIzWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAATusMttstnn2rvnm4Y+jegGiCcgUB9kfdxXcqA9mxaVE9lyddkZ8fYX
J4+Gjtp7rJ6NwRxKx6QlACJjJnWXrH+mo28wbTAdBgNVHQ4EFgQUJji44Ki9hHXr
M2MbhM+eKykpzwYwHwYDVR0jBBgwFoAUJji44Ki9hHXrM2MbhM+eKykpzwYwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZI
zj0EAwIDRwAwRAIgRb6BG8iG6BvTMQL7vumSSzi6NLfll4SpvoiDKDe9FggCIEJe
E8Af7ZSCDKbOT+KWyrggFNal+r+cdF5QQucRZziN
-----END CERTIFICATE-----
`;

export const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgxbTXES7J+WCGmmsN
IerrHEGKzGBO6S5MiHaE0An53vOhRANCAATusMttstnn2rvnm4Y+jegGiCcgUB9k
fdxXcqA9mxaVE9lyddkZ8fYXJ4+Gjtp7rJ6NwRxKx6QlACJjJnWXrH+m
-----END PRIVATE KEY-----
`;
