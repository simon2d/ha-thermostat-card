# ha-thermostat-card

A custom thermostat card for Home Assistant with a dark dial UI, ambient glow, and drag-to-set temperature.

## Installation via HACS

1. In HACS → Frontend → ⋮ → Custom Repositories
2. Add `https://github.com/simon2d/ha-thermostat-card` → category: **Frontend**
3. Install and reload

## Usage

```yaml
type: custom:thermostat-card
entity: climate.living_room
```

Works with any `climate` entity — the room name is pulled automatically from the entity's friendly name.
