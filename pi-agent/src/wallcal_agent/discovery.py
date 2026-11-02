"""What Home Assistant needs to show the Pi as a device (MQTT discovery, architecture section 7.4).

One config message per entity, mirroring calendar-app/server/mqtt/discovery.ts: keys are written out in full,
the messages are retained so Home Assistant has them even if it starts after the Pi, and every entity goes
unavailable with the agent (availability topic plus last will). The sensors also expire if the agent stops
reporting; the panel power does not, because its state is retained and can stay the same for days. The button is
an `event` entity, which is not a reading at all, so it neither expires nor counts as diagnostic: it is the one
entity here a person would put on a dashboard. Presence is a `binary_sensor` that is not diagnostic either, and does
not expire, because it is retained and can stay the same for days in an empty room. The illuminance sensor is not
diagnostic and is not retained, so it expires like the diagnostics, but counted in the light sensor's own reporting
interval, which is much shorter. Pure: no I/O. agent.py publishes these on every connect, and again when Home
Assistant says it has restarted.
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

# How many reporting intervals (the diagnostics', or the light sensor's) may pass with nothing published before Home
# Assistant calls the value unavailable. Three tolerates a missed publish or two but still catches an agent that is
# stuck while its connection stays up.
EXPIRY_INTERVALS = 3


@dataclass(frozen=True)
class DiscoveryMessage:
    """One message to publish: the topic and the JSON of a config."""

    topic: str
    payload: str


def birth_topic(prefix: str) -> str:
    """`homeassistant/status`, where Home Assistant says it has started."""
    return f"{prefix}/status"


def discovery_messages(
    prefix: str,
    display_id: str,
    version: str,
    diagnostics_interval: int,
    button: bool,
    presence: bool,
    light: bool,
    light_report_seconds: int,
) -> list[DiscoveryMessage]:
    """Every discovery message for one Pi, in a fixed order, at `<prefix>/<kind>/wallcal_pi_<id>/<object>/config`.

    The button, presence and then the light sensor come last. With any of them false its message is empty: Home
    Assistant takes an empty retained config to mean "remove this entity", which cleans up after a sensor that has
    since been switched off in the agent's config. `light_report_seconds` is how often the light sensor publishes at
    the least, which is what its entity's expiry is counted in.
    """
    node = f"wallcal_pi_{display_id}"
    device = {
        "identifiers": [node],
        "name": DEVICE_NAME,
        "manufacturer": "Wall Display",
        "model": "Pi agent",
        "sw_version": version,
    }
    origin = {"name": ORIGIN_NAME, "sw_version": version, "url": ORIGIN_URL}

    diagnostics_expiry = EXPIRY_INTERVALS * diagnostics_interval

    # (component, object id, name, seconds before it expires or None if it doesn't, whether it is diagnostic, what is
    # particular to the entity, or None for an entity that is switched off, which gets an empty message where its
    # config would be)
    entities: list[tuple[str, str, str, int | None, bool, dict[str, Any] | None]] = [
        (
            "sensor",
            "cpu_temperature",
            "CPU temperature",
            diagnostics_expiry,
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
            diagnostics_expiry,
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
            None,
            True,
            {
                "state_topic": topics.topic_for(display_id, topics.SCREEN_STATE),
                "device_class": "power",
                "payload_on": topics.screen_payload(True),
                "payload_off": topics.screen_payload(False),
            },
        ),
    ]

    def config_topic(component: str, object_id: str) -> str:
        return f"{prefix}/{component}/{node}/{object_id}/config"

    entities.append(
        (
            "event",
            "button",
            "Button",
            None,
            False,
            {
                "state_topic": topics.topic_for(display_id, topics.BUTTON),
                "event_types": list(topics.BUTTON_GESTURES),
                # Home Assistant's MQTT event wants JSON with an `event_type`, and the contract's payload is
                # the bare word, so the template wraps it.
                "value_template": "{{ {'event_type': value} | tojson }}",
                "device_class": "button",
                "icon": "mdi:gesture-tap-button",
            }
            if button
            else None,
        )
    )
    entities.append(
        (
            "binary_sensor",
            "presence",
            "Presence",
            None,
            False,
            {
                "state_topic": topics.topic_for(display_id, topics.PRESENCE),
                "device_class": "occupancy",
                "payload_on": topics.presence_payload(True),
                "payload_off": topics.presence_payload(False),
            }
            if presence
            else None,
        )
    )
    entities.append(
        (
            "sensor",
            "illuminance",
            "Illuminance",
            EXPIRY_INTERVALS * light_report_seconds,
            False,
            {
                "state_topic": topics.topic_for(display_id, topics.ILLUMINANCE),
                "device_class": "illuminance",
                "unit_of_measurement": "lx",
                "state_class": "measurement",
            }
            if light
            else None,
        )
    )

    messages: list[DiscoveryMessage] = []
    for component, object_id, name, expiry, diagnostic, particular in entities:
        if particular is None:
            messages.append(DiscoveryMessage(topic=config_topic(component, object_id), payload=""))
            continue
        config: dict[str, Any] = {
            "name": name,
            "unique_id": f"{node}_{object_id}",
            **particular,
            "availability_topic": topics.topic_for(display_id, topics.AVAILABILITY),
            "payload_available": topics.ONLINE,
            "payload_not_available": topics.OFFLINE,
            **({"entity_category": "diagnostic"} if diagnostic else {}),
            **({"expire_after": expiry} if expiry is not None else {}),
            "device": device,
            "origin": origin,
            "qos": 1,
        }
        messages.append(
            DiscoveryMessage(topic=config_topic(component, object_id), payload=json.dumps(config, ensure_ascii=False))
        )
    return messages
