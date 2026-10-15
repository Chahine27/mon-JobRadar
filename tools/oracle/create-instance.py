"""
Crée le serveur gratuit « jobradar » chez Oracle (Ubuntu 24.04 ARM), en réessayant tant que Paris n'a plus de place.
Essaie 4 OCPU / 24 Go puis 2 OCPU / 12 Go à chaque tour, toutes les 5 minutes. S'arrête dès qu'un serveur existe.

  tools/oracle/.venv/Scripts/python tools/oracle/create-instance.py

Lit ~/.oci/config (clé d'API) et ~/.ssh/jobradar_oracle.pub (clé SSH du serveur). Rien de payant : forme
VM.Standard.A1.Flex « Toujours gratuit », disque par défaut.
"""
import time
from datetime import datetime
from pathlib import Path

import oci

NAME = "jobradar"
SHAPES = [(4, 24), (2, 12)]
WAIT_S = 300

cfg = oci.config.from_file()
tenancy = cfg["tenancy"]
compute = oci.core.ComputeClient(cfg)
net = oci.core.VirtualNetworkClient(cfg)
ad = oci.identity.IdentityClient(cfg).list_availability_domains(tenancy).data[0].name
subnet = next(s for s in net.list_subnets(tenancy).data if not s.prohibit_public_ip_on_vnic)
image = compute.list_images(
    tenancy, operating_system="Canonical Ubuntu", operating_system_version="24.04",
    shape="VM.Standard.A1.Flex", sort_by="TIMECREATED", sort_order="DESC",
).data[0]
ssh_key = (Path.home() / ".ssh" / "jobradar_oracle.pub").read_text().strip()


def log(msg: str) -> None:
    print(f"[{datetime.now():%d/%m %H:%M:%S}] {msg}", flush=True)


def existing():
    return next((i for i in compute.list_instances(tenancy, display_name=NAME).data if i.lifecycle_state != "TERMINATED"), None)


def launch(ocpus: int, mem: int):
    return compute.launch_instance(oci.core.models.LaunchInstanceDetails(
        compartment_id=tenancy,
        availability_domain=ad,
        display_name=NAME,
        shape="VM.Standard.A1.Flex",
        shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(ocpus=ocpus, memory_in_gbs=mem),
        source_details=oci.core.models.InstanceSourceViaImageDetails(image_id=image.id),
        create_vnic_details=oci.core.models.CreateVnicDetails(subnet_id=subnet.id, assign_public_ip=True),
        metadata={"ssh_authorized_keys": ssh_key},
    )).data


def public_ip(instance_id: str) -> str:
    att = compute.list_vnic_attachments(tenancy, instance_id=instance_id).data[0]
    return net.get_vnic(att.vnic_id).data.public_ip


log(f"Image {image.display_name}, sous-réseau {subnet.display_name}, domaine {ad}.")
attempt = 0
while True:
    inst = existing()
    if inst:
        log(f"Serveur « {NAME} » créé ({inst.lifecycle_state}). Attente du démarrage…")
        inst = oci.wait_until(compute, compute.get_instance(inst.id), "lifecycle_state", "RUNNING", max_wait_seconds=900).data
        ip = public_ip(inst.id)
        log(f"PRÊT : {inst.shape_config.ocpus:g} OCPU / {inst.shape_config.memory_in_gbs:g} Go, adresse IP publique {ip}")
        (Path(__file__).parent / "instance.txt").write_text(f"{ip}\n")
        break
    attempt += 1
    for ocpus, mem in SHAPES:
        try:
            launch(ocpus, mem)
            log(f"Création acceptée avec {ocpus} OCPU / {mem} Go.")
            break
        except oci.exceptions.ServiceError as e:
            if "capacity" in e.message.lower():
                log(f"Essai {attempt} : plus de place pour {ocpus} OCPU / {mem} Go.")
            elif e.status == 429:
                log(f"Essai {attempt} : Oracle demande de ralentir.")
                break
            else:
                raise
    else:
        time.sleep(WAIT_S)
        continue
    if not existing():
        time.sleep(WAIT_S)
