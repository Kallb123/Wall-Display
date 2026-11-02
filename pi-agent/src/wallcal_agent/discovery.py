"""What Home Assistant needs to show the Pi as a device (MQTT discovery, architecture section 7.4).

One config message per entity, mirroring calendar-app/server/mqtt/discovery.ts: keys are written out in full,
the messages are retained so Home Assistant has them even if it starts after the Pi, and every entity goes
unavailable with the agent (availability topic plus last will). The sensors also expire if the agent stops
reporting; the panel power does not, because its state is retained and can stay the same for days. Pure: no I/O.
agent.py publishes these on every connect, and again when Home Assistant says it has restarted.
"""

import json
from dataclasses import dataclass
from typing import Any

from . import topics

DEVICE_NAME = "Wall Calendar Pi"
ORIGIN_NAME = "Wall Calendar Pi agent"
ORIGIN_URL = "https://github.com/kallb123/wall-display"

# What Home Assistant publishes on the birth topic when it is up and wants the configs again.
BIRTH_ONLINE = "online"

# How many diagnostics intervals may pass with nothing published before Home Assistant calls the value unavailable.
# Three tolerates a missed publish or two but still catches an agent that is stuck while its connection stays up.
EXPIRY_INTERVALS = 3


@dataclass(frozen=True)
class DiscoveryMessage:
    """One message to publish: the topic and the JSON of a config."""

    topic: str
    payload: str


def birth_topic(prefix: str) -> str:
    """`homeassistant/status`, where Home Assistant says it has started."""
    return f"{prefix}/status"


def discovery_messages(prefix: str, display_id: str, version: str, diagnostics_interval: int) -> list[DiscoveryMessage]:
    """Every discovery message for one Pi, in a fixed order, at `<prefix>/<kind>/wallcal_pi_<id>/<object>/config`."""
    node = f"wallcal_pi_{display_id}"
    device = {
        "identifiers": [node],
        "name": DEVICE_NAME,
        "manufacturer": "Wall Display",
        "model": "Pi agent",
        "sw_version": version,
    }
    origin = {"name": ORIGIN_NAME, "sw_version": version, "url": ORIGIN_URL}

    # (component, object id, name, whether it expires, what is particular to the entity)
    entities: list[tuple[str, str, str, bool, dict[str, Any]]] = [
        (
            "sensor",
            "cpu_temperature",
            "CPU temperature",
            True,
            {
                "state_topic": topics.topic_for(display_id, topics.CPU_TEMPERATURE),
                "device_class": "temperature",
                "unit_of_measurement": "°C",
                "state_class": "measurement",
                "suggested_display_precision": 1,
            },
        ),
        (
            "sensor",
            "uptime",
            "Uptime",
            True,
            {
                "state_topic": topics.topic_for(display_id, topics.UPTIME),
                "device_class": "duration",
                "unit_of_measurement": "s",
                "icon": "mdi:timer-outline",
            },
        ),
        (
            "binary_sensor",
            "panel_power",
            "Panel power",
            False,
            {
                "state_topic": topics.topic_for(display_id, topics.SCREEN_STATE),
                "device_class": "power",
                "payload_on": topics.screen_payload(True),
                "payload_off": topics.screen_payload(False),
            },
        ),
    ]

    messages: list[DiscoveryMessage] = []
    for component, object_id, name, expires, particular in entities:
        config: dict[str, Any] = {
            "name": name,
            "unique_id": f"{node}_{object_id}",
            **particular,
            "availability_topic": topics.topic_for(display_id, topics.AVAILABILITY),
            "payload_available": topics.ONLINE,
            "payload_not_available": topics.OFFLINE,
            "entity_category": "diagnostic",
            **({"expire_after": EXPIRY_INTERVALS * diagnostics_interval} if expires else {}),
            "device": device,
            "origin": origin,
            "qos": 1,
        }
        messages.append(
            DiscoveryMessage(
                topic=f"{prefix}/{component}/{node}/{object_id}/config",
                payload=json.dumps(config, ensure_ascii=False),
            )
        )
    return messages
