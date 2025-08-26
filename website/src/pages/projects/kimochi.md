---
layout: '../../layouts/PostLayout.astro'
title: 'Kimochi'
pubDate: 2025-08-16
description: "My personal website you are visiting right now, built with Astro.js and deployed with Kubernetes, Helm, Github Actions and Flux CD."
#'Hosting a personal webpage using a modern cloud-native approach.'
author: 'Jonas Horstmann'
githubProjectName: 'kimochi'
image:
    url: 'https://docs.astro.build/assets/rose.webp'
    alt: 'The Astro logo on a dark background with a pink glow.'
tags: ["astro", "blogging", "learning in public"]
---

Again this is not meant to be a complete tutorial that can be followed step-by-step but rather an overview over related concepts and ideas to setup a personal webpage on a vps using cloud native principles.

## Provisioning

The first step when interacting with cloud resources is typically to provision them. For this there are several tools available, like [Terraform](https://developer.hashicorp.com/terraform), or [Ansible](https://docs.ansible.com/) for simple workflows if one wants to leverage the Infrastructure as Code (IaC) workflow.
We will skip over this section because we are dealing with a single vps, where we want to setup our personal webpage so in this case we just provision our infrastructure once manually.

## Configuration

So after we manually provisioned our VPS, the next step we want to take is to configure our server in a reproducable way.

Some of my goals for this step are
1. Initial setup of the VPS
- creating a non root user
- easy access to the server over ssh
- minimizing attack vectors by prohibiting password authentication and root logins

2. Setting up k8s
- setting up a lightweight single-node k8s cluster
- installing Helm to manage releases
- configuring a GitOps workflow through Flux CD

One of the most commonly used tools for automated server configuration is [Ansible](https://docs.ansible.com/).

### Ansible

Ansible has two basic concepts: Inventories and Playbooks.
Inventories describe the set of servers / machines we want to configure and playbooks contain the instructions that actually configure them.

Because we only need to manage our single VPS our inventory file contains only the domain of my personal webpage.
```ini title="inventory.ini"
[personal_vps]
jonhor.de
```

#### Initial Setup
Next let's cover the playbook for the initial VPS setup

```yaml title="setup.yaml"
- name: VPS initial setup
  hosts: all
  remote_user: root
  become: true

  vars:
    new_user: "jns"
    ssh_public_key: "ssh-rsa AAAAB3NzaC1yc..."

  tasks:
    - name: Create a new user with sudo privileges and disable root login
      user:
        name: "{{ new_user }}"
        state: present
        groups: sudo
        append: true
        shell: /bin/bash
        comment: "Ansible-created user"
      
    - name: Allow passwordless sudo for the new user
      copy:
        dest: "/etc/sudoers.d/{{ new_user }}"
        content: "{{ new_user }} ALL=(ALL) NOPASSWD:ALL"
        owner: root
        group: root
        mode: '0440'

    - name: Add the SSH public key to the new user
      authorized_key:
        user: "{{ new_user }}"
        state: present
        key: "{{ ssh_public_key }}"

    - name: Disable SSH password authentication
      lineinfile:
        path: /etc/ssh/sshd_config
        regexp: '^PasswordAuthentication'
        line: 'PasswordAuthentication no'

    - name: Disable SSH root login
      lineinfile:
        path: /etc/ssh/sshd_config
        regexp: '^PermitRootLogin'
        line: 'PermitRootLogin no'

    - name: Restart the SSH service to apply changes
      service:
        name: ssh
        state: restarted
```
`setup.yaml` contains the tasks we want to perform. Basically creating a new user and changing some configuration files and then restarting the ssh service to take effect.

One core conept of Ansible playbooks is idempotency, meaning that it should be possible to run a playbook multiple times without altering the result.
This is not always possible or at least needs additional effort to achieve. For example in this case we disallow root login, such that in subsequent calls we would need to tell Ansible to now connect to our inventory through a different user, i.e. the newly created `jns` user.

#### Setting up the k8s cluster

Because our vps has only 2gb of main memory, we want to use a lightweight k8s setup. One possible choice is [k3s](https://k3s.io/), which is primarily used for IoT and edge devices with constrained resources.

> Setting up this cluster is mainly for educational purposes. In a real production setup you would typically have multiple nodes / control planes to achieve high availability.
> Nonetheless, setting setting up a cluster in this way still has many advantages like leveraging the typical container workflow, managing new releases of our webpage and automating the deployment.

```yaml title="k3s.yaml"
- name: Setup a single-node k3s cluster
  hosts: personal_vps
  remote_user: jns

  tasks:
    - name: Update and upgrade all packages
      become: true
      apt:
        update_cache: yes
        upgrade: dist
        autoremove: yes
      
    - name: Install k3s with a single-node configuration
      become: true
      shell: |
        curl -sfL https://get.k3s.io | sh -
      args:
        creates: /etc/rancher/k3s/k3s.yaml

    - name: Ensure k3s config is readable by the user
      become: true
      file:
        path: /etc/rancher/k3s/k3s.yaml
        mode: '0644'
        owner: "{{ ansible_user }}"
        group: "{{ ansible_user }}"

    - name: Install helm
      shell: |
        curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
      args:
        creates: /usr/local/bin/helm

    - name: Ensure .kube directory exists
      file:
        path: "{{ ansible_user_dir }}/.kube"
        owner: "{{ ansible_user_id }}"
        mode: '0755'
        state: directory

    - name: Create symlink for kubeconfig to ensure helm works with k3s
      file:
          src: /etc/rancher/k3s/k3s.yaml
          dest: "{{ ansible_user_dir }}/.kube/config"
          owner: "{{ ansible_user_id }}"
          state: link

    - name: Install Flux
      become: true
      shell: |
        curl -s https://fluxcd.io/install.sh | sudo bash
      args:
        creates: /usr/local/bin/flux
```

The `k3s.yaml` playbook sets up everything around our cluster. In addition to k3s, it installs Helm and Flux, which we will be talking about in a bit.

So now that we configured our vps to run a k8s cluster, we next look at how we can use a git centric workflow to integrate and deploy our website automatically.

## Continuous Integration 

For the first part, _integration_, we look at [GitHub Actions](https://github.com/features/actions), which became really popular over the last years. Of course there are alternatives like [GitLab CI/CD](https://docs.gitlab.com/ci/) or self hosted solutions like [Jenkins](https://www.jenkins.io/).

GitHub Actions make it really convenient to automate everything around your git repository in a central place.
It also has a rich ecosystem of pre-defined workflows available through its marketplace.

I wanted to play around with it a bit and decided to implement the following workflow.

First I opted for a basic git branching workflow of having a `main` and a `develop` branch. Of course there are other more or less well-defined workflows such as [trunk-based](https://trunkbaseddevelopment.com/) or [Git-flow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow), which might be better suited for more complex projects.
In my workflow I treat the `main` branch as the one where new releases are made and `develop` for actually making changes during development.

### Pull Request Checks

For this I treat the `main` branch as protected and only allow merges through pull requests. Whenever a new pull request for a new release is made, this workflow runs a bunch of checks to ensure that the merge will actually produce a usable release.

```yaml title="pull-request-checks.yaml"
# Verifies and builds the app image and makes it available locally.
# The helm chart is also verified and installed in a local kind cluster using the previously built image.
# Based on the example workflow from https://github.com/helm/chart-testing-action

name: Pull Request Checks

on: pull_request
  
jobs:
  build-and-lint:
    runs-on: ubuntu-latest

    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Validate build configuration
        uses: docker/build-push-action@v6
        with:
          context: ./website
          file: ./website/Dockerfile
          call: check

      - name: Build and load image
        uses: docker/build-push-action@v4
        with:
          context: ./website
          file: ./website/Dockerfile
          push: false
          load: true
          tags: kimochi:${{ github.sha}}

      - name: Set up Helm
        uses: azure/setup-helm@v1
        with:
          version: '3.18.4' 

      - name: Set up Python
        uses: actions/setup-python@v5.3.0
        with:
          python-version: '3.x'
          check-latest: true

      - name: Set up chart-testing (ct)
        uses: helm/chart-testing-action@v2.7.0

      - name: Run chart-testing (list-changed)
        id: list-changed
        run: |
          changed=$(ct list-changed --target-branch ${{ github.event.repository.default_branch }})
          if [[ -n "$changed" ]]; then
            echo "changed=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Run chart-testing (lint)
        if: steps.list-changed.outputs.changed == 'true'
        run: ct lint --target-branch ${{ github.event.repository.default_branch }}

      - name: Create kind cluster
        if: steps.list-changed.outputs.changed == 'true'
        uses: helm/kind-action@v1.12.0

      - name: Run chart-testing (install)
        if: steps.list-changed.outputs.changed == 'true'
        run: ct install --target-branch ${{ github.event.repository.default_branch }} --helm-extra-set-args "--set image.repository=kimochi --set image.tag=${{ github.sha }}"
```

It builds a container with buildx and uses [chart-testing](https://github.com/helm/chart-testing) to test the Helm chart in a local kind cluster. Of course one could extend this with plenty of additional tests, but this is enough to satisfy my curiosity for now.

### Push Workflow

After the checks passed and the merge is performed a second workflow is run.

```yaml title="update-image-tag.yaml"
name: Update the image tag in Helm values.yaml

on:
  push:
    branches:
      - main

jobs:
  update-image:
    runs-on: ubuntu-latest

    permissions:
      contents: write
      packages: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
              
      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: ./website
          file: ./website/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository }}:latest,ghcr.io/${{ github.repository }}:${{ github.sha }}

      - name: Update Helm values.yaml with new image tag
        uses: mikefarah/yq@master
        with:
          cmd: yq -i '.image.tag = "${{ github.sha }}"' ./helm/values.yaml

      - name: Commit and push changes
        uses: stefanzweifel/git-auto-commit-action@v6
        with:
          commit_message: "Automated: Update image tag in values.yaml to ${{ github.sha }}"
```

This workflow builds a nginx container hosting the webpage and uploads it to the GitHub Container Registry (ghcr).
In addition it also updates the image tag (which is based on the commit hash) in the `values.yaml` file inside the Helm chart.
This ensures that a new release of the webpage will be deployed when manually running `helm update`. It also pushed a new commit with the changed values file.

> Updating text in a file is typically done with `sed`, which works fine for most use cases.
> When working with structured data formats like json or yaml, we often have to be more careful, as to ensure
> we actually replace the correct value. For example there can be multiple keys with the same name in different objects /
> locations of the document. This is why I like to use tools for this job that actually take the structure of the document into account.
> One popular tool for this is [yq](https://github.com/mikefarah/yq).

## Continuous Deployment

Next let's look at our cluster again and see how we can automate the deployment / delivery of our website releases.

### Kubernetes 

First let's look at which Kubernetes resources we actually need to run the website.
Because the website is a simple static site generated through Astro.js, we don't need any backend services that expose RESTful APIs or databases.

The basics therefore just include
- a deployment for the nginx container, that serves the static files
- a service that makes the app available inside the cluster
- an ingress resource that handles incoming requests and routes them to the service

Some additional resources that handle security, namely
- a Let's Encrypt certificate issuer to allow trusted https connections
- a middleware that redirects all requests to use https

### Helm

Helm is a package manager for Kubernetes that allows us to manage releases, rollbacks and others.
One main concept of Helm is to template Kubernetes resources, such that it is easy to switch out or overwrite values in multiple resource files at a central location.

```yaml title="values.yaml"
environment: staging
email: "jonas.horstmann2804@gmail.com"
image:
  repository: ghcr.io/jonhor/kimochi
  tag: "1cba65beaef8404ce82b27eca379af4da0b0c62a"
```

This is what the `values.yaml` looks like for this simple app, of course you can also define multiple values files for different environments (dev, staging, prod, ...).
In this case I just overwrite the environment value with production when I actually deploy a new release. This value is only used for the certificate issuer right now, to avoid rate limiting when
requesting too many certificates in a certain time span. 

```yaml title="Chart.yaml"
apiVersion: v2
name: kimochi
version: 0.1.0
description: A simple app deployment for a personal webpage.
type: application
```

The acutal chart definition is also very simple in this case.

### Flux CD

GitOps is a workflow where the git repository acts as the single source of truth, and we use tooling around it to ensure that the state that is declared inside the repository is actually mapped to out cluster.
Prominent tools that facilitate the GitOps workflow are ArgoCD and Flux CD. I first wanted to use ArgoCD but the VPS is too resource constrained and Argo is quite heavyweight compared to Flux. So in the end I decided to go with Flux. I also like how Flux defines their custom resources, it maps better to what I expected the workflow to look like.

```yaml title="git-repository.yaml"
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: kimochi-repo
  namespace: flux-system
spec:
  interval: 1h
  url: https://github.com/jonhor/kimochi
  ref:
    branch: main
  ignore: |
    # exclude all
    /*
    # include Helm directory
    !/helm/  
```

First we define a git repository which holds the our Helm chart.

```yaml title="helm-release"
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: kimochi-release
  namespace: kimochi
spec:
  interval: 1h
  chart:
    spec:
      chart: helm
      sourceRef:
        kind: GitRepository
        name: kimochi-repo
        namespace: flux-system
      valuesFiles:
        - helm/values.yaml
  values:
    environment: production
```

Then we define a Helm release resource that references the git repository. I think this is a very intuitive architecture that works as expected.
Of course there are a lot of different setups you can model with Flux CD. This model is specific to having a monorepo where the Chart is part of the repository and not in a private artifact hub / chart repository for example.

So in the end we first looked at a way to automate the configuration / setup of our VPS.
We then defined a CI pipeline that automatically provides some sanity checks as well as generating a new Helm release for us.
Finally, Flux CD then sees the new release and automatically deploys it to the k8s cluster.

Thanks for reading!

<!-- ## Improvements -->
