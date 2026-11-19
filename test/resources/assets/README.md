The certificates in this folder are only for testing purposes and are **not** valid certificates.

They were generated using the following command:
- Generate an RSA private key:
`openssl genrsa -out key.pem`
- Generate a csr using all default options and common name as "localhost":
`openssl req -new -key key.pem -out csr.pem`
- Self-sign the certificate:
`openssl x509 -req -days 9999 -in csr.pem -signkey key.pem -out cert.pem`