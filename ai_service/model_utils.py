from typing import List, Tuple
import torch
import timm
import torch.nn as nn


def create_model(model_name: str, num_classes: int) -> nn.Module:
    return timm.create_model(model_name, pretrained=True, num_classes=num_classes)


def get_feature_extractor(model: nn.Module) -> nn.Module:
    class Feat(nn.Module):
        def __init__(self, m: nn.Module):
            super().__init__()
            self.m = m

        def forward(self, x):
            feats = self.m.forward_features(x)
            if feats.dim() == 4:
                feats = feats.mean(dim=[2, 3])
            return feats

    return Feat(model)


def save_checkpoint(path: str, model: nn.Module, model_name: str, img_size: int, class_names: List[str]) -> None:
    torch.save(
        {
            "state_dict": model.state_dict(),
            "model_name": model_name,
            "img_size": img_size,
            "class_names": class_names,
        },
        path,
    )


def load_checkpoint(path: str, device: torch.device) -> Tuple[nn.Module, int, List[str], str]:
    ckpt = torch.load(path, map_location=device)
    model_name = ckpt["model_name"]
    class_names = ckpt["class_names"]
    img_size = ckpt["img_size"]
    model = create_model(model_name, num_classes=len(class_names))
    model.load_state_dict(ckpt["state_dict"])
    model.to(device).eval()
    return model, img_size, class_names, model_name