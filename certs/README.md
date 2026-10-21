# Corporate CA certificate (optional)

If package downloads fail with a certificate error behind the company network, ask IT for the corporate root CA certificate in PEM format and save it here as `corporate-ca.crt`. Both Dockerfiles use it while installing packages; without it the builds run unchanged.

`*.crt` files in this folder are git-ignored. Do not commit them.
