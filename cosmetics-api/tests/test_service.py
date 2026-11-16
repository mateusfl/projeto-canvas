import base64
import logging
import hashlib
import hmac
import io
import json
import os
import sys
import tempfile
import time
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from wsgiref.util import setup_testing_defaults

_tmp = tempfile.TemporaryDirectory()
os.environ["COSMETICS_DB"] = str(Path(_tmp.name) / "test.sqlite")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from spyne.server.wsgi import WsgiApplication  # noqa: E402

import auth  # noqa: E402
import store  # noqa: E402
from service import application  # noqa: E402

SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
TNS = "urn:snake-arena:cosmetics"
NS = {"soap": SOAP, "c": TNS}

logging.getLogger("spyne.application.client").setLevel(logging.CRITICAL)
store.init()
wsgi = WsgiApplication(application)


def make_token(sub: str = "7", exp_in: int = 60, secret: bytes = auth.JWT_SECRET):
    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({"sub": sub, "exp": int(time.time()) + exp_in}).encode())
    signature = hmac.new(secret, f"{header}.{payload}".encode(), hashlib.sha256)
    return f"{header}.{payload}.{b64(signature.digest())}"


def call(body: str, header: str = "") -> tuple[str, ET.Element]:
    envelope = (
        f'<soap:Envelope xmlns:soap="{SOAP}" xmlns:c="{TNS}">'
        f"<soap:Header>{header}</soap:Header><soap:Body>{body}</soap:Body>"
        "</soap:Envelope>"
    ).encode()
    environ: dict = {}
    setup_testing_defaults(environ)
    environ.update(
        REQUEST_METHOD="POST",
        CONTENT_TYPE="text/xml; charset=utf-8",
        CONTENT_LENGTH=str(len(envelope)),
    )
    environ["wsgi.input"] = io.BytesIO(envelope)

    status = []
    chunks = wsgi(environ, lambda s, _headers: status.append(s))
    root = ET.fromstring(b"".join(chunks))
    payload = root.find("soap:Body", NS)[0]
    return status[0], payload


def auth_header(token: str) -> str:
    return f"<c:AuthHeader><c:token>{token}</c:token></c:AuthHeader>"


def fault_code(payload: ET.Element) -> str:
    return payload.findtext("faultcode").split(":", 1)[1]


class ListAccessoriesTest(unittest.TestCase):
    def test_lista_o_catalogo_inteiro(self):
        status, payload = call("<c:ListAccessories/>")
        self.assertTrue(status.startswith("200"))
        slots = {a.findtext("c:slot", namespaces=NS) for a in payload.iter(f"{{{TNS}}}Accessory")}
        self.assertEqual(slots, {"head", "face"})

    def test_filtra_por_espaco(self):
        _, payload = call("<c:ListAccessories><c:slot>face</c:slot></c:ListAccessories>")
        slots = [a.findtext("c:slot", namespaces=NS) for a in payload.iter(f"{{{TNS}}}Accessory")]
        self.assertTrue(slots)
        self.assertEqual(set(slots), {"face"})

    def test_espaco_fora_do_contrato_vira_fault(self):
        status, payload = call("<c:ListAccessories><c:slot>tail</c:slot></c:ListAccessories>")
        self.assertTrue(status.startswith("500"))
        self.assertEqual(fault_code(payload), "Client.SchemaValidationError")


class CustomizationTest(unittest.TestCase):
    def test_jogador_sem_escolhas_nao_tem_acessorios(self):
        _, payload = call("<c:GetCustomization><c:playerId>404</c:playerId></c:GetCustomization>")
        customization = payload.find("c:customization", NS)
        self.assertEqual(customization.findtext("c:playerId", namespaces=NS), "404")
        self.assertIsNone(customization.find("c:head", NS))

    def test_salva_e_le_as_escolhas_do_dono_do_token(self):
        status, _ = call(
            "<c:SetCustomization><c:head>crown</c:head><c:face>mustache</c:face></c:SetCustomization>",
            auth_header(make_token("7")),
        )
        self.assertTrue(status.startswith("200"))
        _, payload = call("<c:GetCustomization><c:playerId>7</c:playerId></c:GetCustomization>")
        customization = payload.find("c:customization", NS)
        self.assertEqual(customization.findtext("c:head", namespaces=NS), "crown")
        self.assertEqual(customization.findtext("c:face", namespaces=NS), "mustache")

    def test_omitir_um_espaco_o_deixa_vazio(self):
        call(
            "<c:SetCustomization><c:head>horns</c:head><c:face>tongue</c:face></c:SetCustomization>",
            auth_header(make_token("8")),
        )
        _, payload = call(
            "<c:SetCustomization><c:face>monocle</c:face></c:SetCustomization>",
            auth_header(make_token("8")),
        )
        customization = payload.find("c:customization", NS)
        self.assertIsNone(customization.find("c:head", NS))
        self.assertEqual(customization.findtext("c:face", namespaces=NS), "monocle")


class FaultTest(unittest.TestCase):
    def assertFault(self, code: str, body: str, header: str = ""):
        status, payload = call(body, header)
        self.assertTrue(status.startswith("500"), status)
        self.assertEqual(payload.tag, f"{{{SOAP}}}Fault")
        self.assertEqual(fault_code(payload), code)

    def test_set_sem_header(self):
        self.assertFault("Client.Unauthorized", "<c:SetCustomization/>")

    def test_set_com_assinatura_invalida(self):
        token = make_token(secret=b"outro-segredo")
        self.assertFault("Client.Unauthorized", "<c:SetCustomization/>", auth_header(token))

    def test_set_com_token_expirado(self):
        token = make_token(exp_in=-10)
        self.assertFault("Client.Unauthorized", "<c:SetCustomization/>", auth_header(token))

    def test_acessorio_inexistente(self):
        self.assertFault(
            "Client.UnknownAccessory",
            "<c:SetCustomization><c:head>banana</c:head></c:SetCustomization>",
            auth_header(make_token()),
        )

    def test_acessorio_no_espaco_errado(self):
        self.assertFault(
            "Client.WrongSlot",
            "<c:SetCustomization><c:head>mustache</c:head></c:SetCustomization>",
            auth_header(make_token()),
        )

    def test_player_id_fora_do_contrato(self):
        self.assertFault(
            "Client.SchemaValidationError",
            "<c:GetCustomization><c:playerId>0</c:playerId></c:GetCustomization>",
        )


if __name__ == "__main__":
    unittest.main()
