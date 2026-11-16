from spyne import (
    Application,
    Array,
    ComplexModel,
    Fault,
    Integer,
    ServiceBase,
    Unicode,
    rpc,
)
from spyne.protocol.soap import Soap11

import auth
import catalog
import store

TNS = "urn:snake-arena:cosmetics"

Slot = Unicode(values=list(catalog.SLOTS), type_name="Slot", __namespace__=TNS)
AccessoryId = Unicode(
    max_len=32, pattern="[a-z]+", type_name="AccessoryId", __namespace__=TNS
)
PlayerId = Integer(ge=1, type_name="PlayerId", __namespace__=TNS)


class Accessory(ComplexModel):
    __namespace__ = TNS
    _type_info = [
        ("id", AccessoryId(min_occurs=1)),
        ("slot", Slot(min_occurs=1)),
        ("name", Unicode(min_occurs=1)),
    ]


class Customization(ComplexModel):
    __namespace__ = TNS
    _type_info = [
        ("playerId", PlayerId(min_occurs=1)),
        ("head", AccessoryId),
        ("face", AccessoryId),
    ]


class AuthHeader(ComplexModel):
    __namespace__ = TNS
    _type_info = [("token", Unicode(min_occurs=1, nillable=False))]


def _check(accessory_id: str | None, slot: str) -> None:
    if accessory_id is None:
        return
    item = catalog.BY_ID.get(accessory_id)
    if item is None:
        raise Fault(
            "Client.UnknownAccessory", f'Acessório "{accessory_id}" não existe.'
        )
    if item.slot != slot:
        raise Fault(
            "Client.WrongSlot",
            f'"{item.name}" é um acessório de {catalog.SLOT_NAMES[item.slot]}, '
            f"não de {catalog.SLOT_NAMES[slot]}.",
        )


def _customization(player_id: int) -> Customization:
    head, face = store.get(player_id)
    return Customization(playerId=player_id, head=head, face=face)


class CosmeticsService(ServiceBase):
    @rpc(Slot, _returns=Array(Accessory), _out_variable_name="accessories")
    def ListAccessories(ctx, slot):
        """Catálogo de acessórios, opcionalmente filtrado por espaço (`head` ou `face`)."""
        return [
            Accessory(id=item.id, slot=item.slot, name=item.name)
            for item in catalog.list_items(slot)
        ]

    @rpc(
        PlayerId(min_occurs=1, nillable=False),
        _returns=Customization,
        _out_variable_name="customization",
    )
    def GetCustomization(ctx, playerId):
        """Acessórios que um jogador está usando."""
        return _customization(playerId)

    @rpc(
        AccessoryId,
        AccessoryId,
        _in_header=(AuthHeader,),
        _returns=Customization,
        _out_variable_name="customization",
    )
    def SetCustomization(ctx, head, face):
        """Troca os acessórios do jogador do token. Omitir um espaço o deixa vazio."""
        header = ctx.in_header
        if header is None or not header.token:
            raise Fault(
                "Client.Unauthorized", "AuthHeader com o token JWT é obrigatório."
            )
        try:
            player_id = auth.player_id_from(header.token)
        except auth.InvalidToken as err:
            raise Fault("Client.Unauthorized", f"Token inválido: {err}.") from err

        _check(head, "head")
        _check(face, "face")
        store.save(player_id, head, face)
        return _customization(player_id)


application = Application(
    [CosmeticsService],
    name="CosmeticsService",
    tns=TNS,
    in_protocol=Soap11(validator="lxml"),
    out_protocol=Soap11(),
)
