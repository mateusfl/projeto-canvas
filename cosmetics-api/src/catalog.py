from dataclasses import dataclass

SLOTS = ("head", "face")
SLOT_NAMES = {"head": "cabeça", "face": "rosto"}


@dataclass(frozen=True)
class Item:
    id: str
    slot: str
    name: str


CATALOG = (
    Item("tophat", "head", "Cartola"),
    Item("crown", "head", "Coroa"),
    Item("antennae", "head", "Antenas"),
    Item("propeller", "head", "Hélice"),
    Item("horns", "head", "Chifres"),
    Item("sunglasses", "face", "Óculos escuros"),
    Item("mustache", "face", "Bigode"),
    Item("monocle", "face", "Monóculo"),
    Item("eyepatch", "face", "Tapa-olho"),
    Item("tongue", "face", "Língua"),
)

BY_ID = {item.id: item for item in CATALOG}


def list_items(slot: str | None = None) -> list[Item]:
    return [item for item in CATALOG if slot is None or item.slot == slot]
