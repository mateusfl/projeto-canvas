import base64
import hashlib
import hmac
import json
import os
import time

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-troque-em-producao").encode()


class InvalidToken(Exception):
    pass


def _b64decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def player_id_from(token: str) -> int:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        header = json.loads(_b64decode(header_b64))
        signature = _b64decode(signature_b64)
        payload = json.loads(_b64decode(payload_b64))
    except ValueError as err:
        raise InvalidToken("token malformado") from err

    if header.get("alg") != "HS256":
        raise InvalidToken("algoritmo não suportado")
    expected = hmac.new(
        JWT_SECRET, f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(signature, expected):
        raise InvalidToken("assinatura inválida")
    if not isinstance(payload.get("exp"), int) or payload["exp"] < time.time():
        raise InvalidToken("token expirado")

    try:
        player_id = int(payload["sub"])
    except (KeyError, ValueError) as err:
        raise InvalidToken("token sem jogador") from err
    if player_id < 1:
        raise InvalidToken("token sem jogador")
    return player_id
